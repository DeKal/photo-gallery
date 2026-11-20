"""Background scan worker: walk a folder, embed images and faces, persist rows.

``run_scan`` runs in a FastAPI ``BackgroundTasks`` thread, so it opens its own
SQLAlchemy session rather than sharing the request-scoped one. It is idempotent:
photos are keyed by content sha256, so re-scanning a folder skips files already
indexed. Per-file failures are recorded on ``photos.error`` and do not abort the
scan; an unexpected fatal error marks the scan ``failed`` and re-raises so it is
visible in the logs.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from app.analyzer import detect_faces, embed_images
from app.config import settings
from app.db import SessionLocal
from app.drive import download_drive_folder, folder_slug, is_drive_url
from app.models import Face, ImageEmbedding, Photo, Scan
from app.scanner import (
    UnreadableImageError,
    file_sha256,
    file_taken_at,
    image_sharpness,
    iter_images,
    load_image,
    make_face_thumbnail,
    make_thumbnail,
)

logger = logging.getLogger(__name__)

_COMMIT_EVERY = 10

# How many images to decode + thumbnail ahead of the model loop. The decode and
# JPEG thumbnail of a full-res photo are I/O/PIL bound and release the GIL, so a
# small pool overlaps them with the (single-threaded) CLIP + InsightFace work on
# the main thread. Kept low because each in-flight item holds a decoded full-res
# image in memory.
_PREFETCH = 4


def run_scan(scan_id: int) -> None:
    """Execute the scan identified by ``scan_id`` to completion.

    Loads the ``Scan`` row, enumerates the images under its ``root_path``, and
    for each new file persists a ``Photo`` plus its CLIP ``ImageEmbedding`` and
    any detected ``Face`` rows, updating ``scan.done`` as it goes.
    """
    session = SessionLocal()
    try:
        scan = session.get(Scan, scan_id)
        if scan is None:
            logger.error("run_scan: no Scan row with id=%s", scan_id)
            return

        scan.status = "running"
        scan.started_at = datetime.now(timezone.utc)
        session.commit()

        # A Drive folder is downloaded to a local staging dir first; the rest of
        # the pipeline then runs over those local files exactly as for a local
        # folder. ``drive_ids`` maps each absolute local path to its Drive id.
        # The download is surfaced as a distinct ``downloading`` phase: gdown's
        # folder download is one blocking call with no per-file hook, so a
        # watcher thread counts files landing in the staging dir and writes
        # progress to the scan row (via its own session) while it runs.
        drive_ids: dict[str, str] = {}
        if is_drive_url(scan.root_path):
            dest = settings.data_dir / "drive" / folder_slug(scan.root_path)
            scan.status = "downloading"
            scan.done = 0
            scan.total = 0
            session.commit()

            total_box = {"n": 0}
            stop = threading.Event()

            def _watch() -> None:
                watch_session = SessionLocal()
                try:
                    while not stop.wait(1.0):
                        n = sum(1 for p in dest.rglob("*") if p.is_file())
                        row = watch_session.get(Scan, scan_id)
                        if row is not None:
                            row.done = n
                            row.total = total_box["n"]
                            watch_session.commit()
                finally:
                    watch_session.close()

            watcher = threading.Thread(target=_watch, daemon=True)
            watcher.start()
            logger.info("run_scan[%s]: downloading Drive folder %s", scan_id, scan.root_path)
            try:
                drive_ids = download_drive_folder(
                    scan.root_path,
                    dest,
                    on_listed=lambda t: total_box.__setitem__("n", t),
                )
            finally:
                stop.set()
                watcher.join(timeout=3)
            logger.info("run_scan[%s]: downloaded %d Drive file(s)", scan_id, len(drive_ids))
            scan_root: str | Path = dest
        else:
            scan_root = scan.root_path

        # Analysis phase: reset the counter so done/total now track indexing.
        # The watcher committed via its own session, so refresh our copy first.
        files = list(iter_images(scan_root))
        session.refresh(scan)
        scan.status = "running"
        scan.done = 0
        scan.total = len(files)
        session.commit()
        logger.info("run_scan[%s]: analyzing %d image(s)", scan_id, len(files))

        # Tag each photo into the scan's target album as soon as it is indexed
        # (not once at the end): the photo appears in the album immediately, and
        # a scan that fails/stalls partway still tags everything it managed to
        # index. Imported here to keep the pipeline's dependency on the albums
        # helper local to the one place it's needed.
        add_to_album = None
        if scan.album_id is not None:
            from app.api.albums import add_photos_to_album as add_to_album

        # Decode + thumbnail the next few images in a thread pool while the main
        # thread runs the models + DB writes on the current one. Results are
        # consumed strictly in order so photo ids stay deterministic.
        with ThreadPoolExecutor(max_workers=_PREFETCH) as pool:
            index = 0
            for path, future in _ordered_prefetch(files, drive_ids, pool, _PREFETCH):
                index += 1
                try:
                    prepared = future.result()
                    photo_id = _index_prepared(session, prepared)
                    if photo_id is not None and add_to_album is not None:
                        add_to_album(session, scan.album_id, [photo_id])
                except Exception as exc:  # noqa: BLE001 - one bad file must not abort
                    logger.exception("run_scan: failed to process %s", path)
                    _record_error(session, path, exc)

                scan.done += 1
                if index % _COMMIT_EVERY == 0:
                    session.commit()

        scan.status = "completed"
        scan.finished_at = datetime.now(timezone.utc)
        session.commit()
    except Exception:
        logger.exception("run_scan: fatal error for scan_id=%s", scan_id)
        session.rollback()
        scan = session.get(Scan, scan_id)
        if scan is not None:
            scan.status = "failed"
            scan.finished_at = datetime.now(timezone.utc)
            session.commit()
        raise
    finally:
        session.close()


def _prepare_file(path, drive_ids: dict[str, str] | None = None) -> dict:
    """I/O-heavy prep for one image, safe to run in a worker thread.

    Hashes the file, decodes it, builds the thumbnail and reads its bytes, and
    gathers metadata — no DB and no model calls (those stay on the main thread).
    PIL decode/encode and file reads release the GIL, so this overlaps with the
    main thread's model inference.
    """
    sha = file_sha256(path)
    img = load_image(path)
    thumb = make_thumbnail(path, settings.thumb_dir, sha256=sha)
    width, height = img.size
    return {
        "path": str(path),
        "sha": sha,
        "img": img,
        "thumb_path": str(thumb),
        "thumb_data": Path(thumb).read_bytes(),
        "width": width,
        "height": height,
        "taken_at": file_taken_at(path),
        "drive_file_id": (drive_ids or {}).get(str(Path(path).resolve())),
    }


def _ordered_prefetch(paths, drive_ids, pool: ThreadPoolExecutor, depth: int):
    """Yield ``(path, future)`` in input order, keeping ``depth`` prep jobs in flight.

    A sliding window bounds how many decoded full-res images are held at once,
    so prefetch speeds the loop up without unbounded memory growth.
    """
    pending: deque = deque()
    it = iter(paths)
    for _ in range(depth + 1):
        p = next(it, None)
        if p is None:
            break
        pending.append((p, pool.submit(_prepare_file, p, drive_ids)))
    while pending:
        path, future = pending.popleft()
        nxt = next(it, None)
        if nxt is not None:
            pending.append((nxt, pool.submit(_prepare_file, nxt, drive_ids)))
        yield path, future


def _index_prepared(session, prepared: dict) -> int | None:
    """Persist a prepared image: photo row, CLIP + face embeddings. Main thread.

    Runs the models and all DB writes here (both single-threaded). Returns the
    photo id (new or already-indexed) so the caller can add it to a scan's
    target album.
    """
    existing = session.query(Photo).filter(Photo.sha256 == prepared["sha"]).first()
    if existing is not None:
        return existing.id  # Already indexed (idempotent / dedup).

    img = prepared["img"]
    # taken_at is never left null: EXIF capture time, then the file's mtime
    # (both via file_taken_at), finally the scan time as a last resort — so the
    # library always has a date to sort/group by.
    now = datetime.now(timezone.utc)
    photo = Photo(
        path=prepared["path"],
        sha256=prepared["sha"],
        width=prepared["width"],
        height=prepared["height"],
        taken_at=prepared["taken_at"] or now,
        thumb_path=prepared["thumb_path"],
        thumb_data=prepared["thumb_data"],
        drive_file_id=prepared["drive_file_id"],
        scanned_at=now,
    )
    session.add(photo)
    session.flush()  # Assigns photo.id.

    vec = embed_images([img])[0]
    session.add(ImageEmbedding(photo_id=photo.id, vec=vec.tolist()))

    for face in detect_faces(img):
        face_row = Face(
            photo_id=photo.id,
            bbox=face["bbox"],
            det_score=face["det_score"],
            vec=face["vec"].tolist(),
        )
        session.add(face_row)
        session.flush()  # Assigns face_row.id for the crop filename.
        thumb_path = make_face_thumbnail(
            img, face["bbox"], settings.thumb_dir, face_row.id
        )
        face_row.thumb_path = str(thumb_path)
        face_row.thumb_data = Path(thumb_path).read_bytes()
        # Tag the crop's focus so clustering can drop blurry faces cheaply.
        face_row.sharpness = image_sharpness(Image.open(thumb_path))

    return photo.id


def _record_error(session, path, exc: Exception) -> None:
    """Record a per-file failure on a ``Photo`` row without aborting the scan."""
    session.rollback()
    try:
        sha = file_sha256(path)
    except Exception:  # noqa: BLE001 - file may be unreadable at the OS level
        logger.exception("run_scan: cannot hash failed file %s", path)
        return

    message = str(exc) or exc.__class__.__name__
    try:
        photo = session.query(Photo).filter(Photo.sha256 == sha).first()
        if photo is None:
            photo = Photo(
                path=str(path),
                sha256=sha,
                error=message,
                scanned_at=datetime.now(timezone.utc),
            )
            session.add(photo)
        else:
            photo.error = message
        session.commit()
    except Exception:  # noqa: BLE001 - best effort; keep the scan alive
        logger.exception("run_scan: could not record error for %s", path)
        session.rollback()
