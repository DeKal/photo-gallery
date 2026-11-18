"""Backfill ``Photo.taken_at`` for rows that are missing it.

Older scans never populated ``taken_at``. This fills each null row with the best
available date so nothing stays "Undated":

    EXIF capture time  ->  file mtime  ->  scanned_at  ->  now

The first two come from ``scanner.file_taken_at`` when the original file is still
on disk; otherwise the row's scan time is used, and finally the current time.

Run from the backend dir with the project venv (it needs filesystem access to
the originals, so run on the host where the worker runs)::

    cd backend && \
    PHOTO_DATABASE_URL=postgresql+psycopg://photo:photo@localhost:5432/photos \
    .venv/bin/python scripts/backfill_taken_at.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

# Make ``app`` importable when run as a script from the backend dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal  # noqa: E402
from app.models import Photo  # noqa: E402
from app.scanner import file_taken_at  # noqa: E402


def main() -> int:
    session = SessionLocal()
    now = datetime.now(timezone.utc)
    from_file = from_scan = from_now = 0
    try:
        photos = (
            session.query(Photo)
            .filter(Photo.taken_at.is_(None), Photo.error.is_(None))
            .order_by(Photo.id)
            .all()
        )
        total = len(photos)
        print(f"Found {total} photo(s) with no taken_at.")

        for i, photo in enumerate(photos, start=1):
            dt = None
            if photo.path and Path(photo.path).is_file():
                dt = file_taken_at(photo.path)
            if dt is not None:
                from_file += 1
            elif photo.scanned_at is not None:
                dt = photo.scanned_at
                from_scan += 1
            else:
                dt = now
                from_now += 1

            photo.taken_at = dt

            if i % 100 == 0:
                session.commit()
                print(f"  {i}/{total} processed...")

        session.commit()
    finally:
        session.close()

    filled = from_file + from_scan + from_now
    print(
        f"\nDone. Filled {filled} row(s): "
        f"from file={from_file}, from scan date={from_scan}, from now={from_now}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
