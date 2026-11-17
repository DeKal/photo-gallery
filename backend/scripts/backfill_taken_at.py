"""Backfill ``Photo.taken_at`` for rows that are missing it.

Older scans never populated ``taken_at``. This fills each null row using the
image's EXIF capture time, falling back to the file's last-modified time (see
``scanner.file_taken_at``). Photos whose original file is missing are skipped.

Run from the backend dir with the project venv (it needs filesystem access to
the originals, so run on the host where the worker runs)::

    cd backend && \
    PHOTO_DATABASE_URL=postgresql+psycopg://photo:photo@localhost:5432/photos \
    .venv/bin/python scripts/backfill_taken_at.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make ``app`` importable when run as a script from the backend dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal  # noqa: E402
from app.models import Photo  # noqa: E402
from app.scanner import file_taken_at  # noqa: E402


def main() -> int:
    session = SessionLocal()
    filled = 0
    skipped: list[tuple[int, str]] = []
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
            if not photo.path or not Path(photo.path).is_file():
                skipped.append((photo.id, f"missing file: {photo.path}"))
                continue

            dt = file_taken_at(photo.path)
            if dt is None:
                skipped.append((photo.id, "no exif/mtime"))
                continue

            photo.taken_at = dt
            filled += 1

            if i % 100 == 0:
                session.commit()
                print(f"  {i}/{total} processed ({filled} filled)...")

        session.commit()
    finally:
        session.close()

    print(f"\nDone. Filled {filled} row(s); {len(skipped)} skipped.")
    if skipped:
        print("Skipped (photo_id: reason):")
        for photo_id, reason in skipped[:50]:
            print(f"  {photo_id}: {reason}")
        if len(skipped) > 50:
            print(f"  ... and {len(skipped) - 50} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
