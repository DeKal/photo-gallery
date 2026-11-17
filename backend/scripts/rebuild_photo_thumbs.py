"""Regenerate photo thumbnails at the current resolution, overwriting the cache.

``make_thumbnail`` is an idempotent cache: it returns the existing file
untouched when one is present. Older thumbnails were rendered at a smaller size,
so this script deletes each cached ``<sha256>.jpg`` first and rebuilds it, then
records the path on the ``Photo`` row.

Photos whose original file is missing/unreadable are skipped and reported.

Run from the backend dir with the project venv::

    cd backend && .venv/bin/python scripts/rebuild_photo_thumbs.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make ``app`` importable when run as a script from the backend dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Photo  # noqa: E402
from app.scanner import UnreadableImageError, make_thumbnail  # noqa: E402


def main() -> int:
    session = SessionLocal()
    built = 0
    failed: list[tuple[int, str]] = []
    try:
        photos = session.query(Photo).order_by(Photo.id).all()
        total = len(photos)
        print(f"Found {total} photo(s).")

        for i, photo in enumerate(photos, start=1):
            if not photo.path or not Path(photo.path).is_file():
                failed.append((photo.id, f"missing file: {photo.path}"))
                continue

            # Drop the stale (smaller) cached thumbnail so make_thumbnail
            # re-renders at the current size instead of returning the old one.
            old = settings.thumb_dir / f"{photo.sha256}.jpg"
            if old.exists():
                old.unlink()

            try:
                thumb = make_thumbnail(
                    photo.path, settings.thumb_dir, sha256=photo.sha256
                )
            except UnreadableImageError as exc:
                failed.append((photo.id, f"unreadable: {exc}"))
                continue
            except Exception as exc:  # noqa: BLE001 - keep backfill going
                failed.append((photo.id, f"thumb error: {exc}"))
                continue

            photo.thumb_path = str(thumb)
            built += 1

            if i % 100 == 0:
                session.commit()
                print(f"  {i}/{total} processed ({built} built)...")

        session.commit()
    finally:
        session.close()

    print(f"\nDone. Rebuilt {built} thumbnail(s); {len(failed)} failed.")
    if failed:
        print("Failures (photo_id: reason):")
        for photo_id, reason in failed[:50]:
            print(f"  {photo_id}: {reason}")
        if len(failed) > 50:
            print(f"  ... and {len(failed) - 50} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
