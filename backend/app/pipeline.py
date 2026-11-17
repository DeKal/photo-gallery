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

from app.analyzer import detect_faces, embed_images
from app.config import settings
from app.db import SessionLocal
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

        files = list(iter_images(scan.root_path))
        scan.total = len(files)
        scan.status = "running"
        scan.started_at = datetime.now(timezone.utc)
        session.commit()

        for index, path in enumerate(files, start=1):
            try:
                _process_file(session, path)
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


def _process_file(session, path) -> None:
    """Index a single image file: thumbnail, photo row, CLIP + face embeddings."""
    sha = file_sha256(path)
    existing = session.query(Photo).filter(Photo.sha256 == sha).first()
    if existing is not None:
        return  # Already indexed (idempotent / dedup).

    img = load_image(path)
    thumb = make_thumbnail(path, settings.thumb_dir, sha256=sha)
    width, height = img.size

    photo = Photo(
        path=str(path),
        sha256=sha,
        width=width,
        height=height,
        taken_at=file_taken_at(path),
        thumb_path=str(thumb),
        scanned_at=datetime.now(timezone.utc),
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
