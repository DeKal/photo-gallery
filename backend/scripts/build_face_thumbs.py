"""Backfill cropped face thumbnails for faces missing ``thumb_path``.

For every ``Face`` row whose ``thumb_path`` is NULL, re-open the parent photo's
original file, crop the stored bbox (expanded + squared), save it under
``settings.thumb_dir/faces/<face_id>.jpg``, and record the path on the row.

Faces whose original photo file is missing/unreadable are skipped and reported.

Run from the backend dir with the project venv::

    cd backend && .venv/bin/python scripts/build_face_thumbs.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make ``app`` importable when run as a script from the backend dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Face, Photo  # noqa: E402
from app.scanner import (  # noqa: E402
    UnreadableImageError,
    load_image,
    make_face_thumbnail,
)


def main() -> int:
    session = SessionLocal()
    built = 0
    failed: list[tuple[int, str]] = []
    try:
        faces = (
            session.query(Face)
            .filter(Face.thumb_path.is_(None))
            .order_by(Face.id)
            .all()
        )
        total = len(faces)
        print(f"Found {total} face(s) without a thumbnail.")

        # Cache decoded photos so a group photo with many faces is opened once.
        photo_cache: dict[int, object] = {}

        for i, face in enumerate(faces, start=1):
            photo = session.get(Photo, face.photo_id)
            if photo is None or not photo.path:
                failed.append((face.id, "no photo row/path"))
                continue

            img = photo_cache.get(face.photo_id)
            if img is None:
                if not Path(photo.path).is_file():
                    failed.append((face.id, f"missing file: {photo.path}"))
                    continue
                try:
                    img = load_image(photo.path)
                except UnreadableImageError as exc:
                    failed.append((face.id, f"unreadable: {exc}"))
                    continue
                photo_cache[face.photo_id] = img

            try:
                thumb = make_face_thumbnail(
                    img, list(face.bbox), settings.thumb_dir, face.id
                )
            except Exception as exc:  # noqa: BLE001 - keep backfill going
                failed.append((face.id, f"crop error: {exc}"))
                continue

            face.thumb_path = str(thumb)
            built += 1

            if i % 100 == 0:
                session.commit()
                print(f"  {i}/{total} processed ({built} built)...")

        session.commit()
    finally:
        session.close()

    print(f"\nDone. Built {built} face thumbnail(s); {len(failed)} failed.")
    if failed:
        print("Failures (face_id: reason):")
        for face_id, reason in failed[:50]:
            print(f"  {face_id}: {reason}")
        if len(failed) > 50:
            print(f"  ... and {len(failed) - 50} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
