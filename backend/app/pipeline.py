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
from datetime import datetime, timezone
from pathlib import Path

from app.analyzer import detect_faces, embed_images
from app.config import settings
from app.db import SessionLocal
from app.drive import download_drive_folder, folder_slug, is_drive_url
from app.models import Face, ImageEmbedding, Photo, Scan
from app.scanner import (
    UnreadableImageError,
    file_sha256,
    file_taken_at,
    iter_images,
    load_image,
    make_face_thumbnail,
    make_thumbnail,
)

logger = logging.getLogger(__name__)

_COMMIT_EVERY = 10


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
        drive_ids: dict[str, str] = {}
        if is_drive_url(scan.root_path):
            dest = settings.data_dir / "drive" / folder_slug(scan.root_path)
            drive_ids = download_drive_folder(scan.root_path, dest)
            scan_root: str | Path = dest
        else:
            scan_root = scan.root_path

        files = list(iter_images(scan_root))
        scan.total = len(files)
        session.commit()

        # Photo ids this scan touched (new or already-indexed), so they can be
        # added to the scan's target album once the walk finishes.
        touched_ids: list[int] = []
        for index, path in enumerate(files, start=1):
            try:
                photo_id = _process_file(session, path, drive_ids)
                if photo_id is not None:
                    touched_ids.append(photo_id)
            except Exception as exc:  # noqa: BLE001 - one bad file must not abort
                logger.exception("run_scan: failed to process %s", path)
                _record_error(session, path, exc)

            scan.done += 1
            if index % _COMMIT_EVERY == 0:
                session.commit()

        if scan.album_id is not None and touched_ids:
            # Imported here (not top-level) to keep the import local to the one
            # place the pipeline needs it.
            from app.api.albums import add_photos_to_album

            add_photos_to_album(session, scan.album_id, touched_ids)

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


def _process_file(session, path, drive_ids: dict[str, str] | None = None) -> int | None:
    """Index a single image file: thumbnail, photo row, CLIP + face embeddings.

    Returns the photo id (new or already-indexed) so the caller can add it to a
    scan's target album; ``None`` only if the row could not be identified.
    """
    sha = file_sha256(path)
    existing = session.query(Photo).filter(Photo.sha256 == sha).first()
    if existing is not None:
        return existing.id  # Already indexed (idempotent / dedup).

    img = load_image(path)
    thumb = make_thumbnail(path, settings.thumb_dir, sha256=sha)
    width, height = img.size

    drive_file_id = (drive_ids or {}).get(str(Path(path).resolve()))
    # taken_at is never left null: EXIF capture time, then the file's mtime
    # (both via file_taken_at), finally the scan time as a last resort — so the
    # library always has a date to sort/group by.
    now = datetime.now(timezone.utc)
    photo = Photo(
        path=str(path),
        sha256=sha,
        width=width,
        height=height,
        taken_at=file_taken_at(path) or now,
        thumb_path=str(thumb),
        thumb_data=Path(thumb).read_bytes(),
        drive_file_id=drive_file_id,
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
