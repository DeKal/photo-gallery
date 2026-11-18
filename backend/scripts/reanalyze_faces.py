"""Rebuild face rows from the original images (recovery after prune_faces).

Deleting faces is irreversible at the DB level, but faces can be *re-detected*
from the source photos. For each selected photo this re-runs InsightFace and
inserts any detected face that isn't already present (matched by bbox IoU, so
faces that survived a prune are not duplicated), regenerating the crop
(``thumb_data``) and the ArcFace embedding.

Important: re-detected faces come back **unclustered** — they belong to no
person until you re-cluster (POST /cluster). Locked/curated persons are
preserved verbatim across re-clustering, so they will NOT automatically absorb
the restored faces; this is a rebuild, not an exact undo of a prior clustering.

Selection:
  --missing            photos that currently have zero faces (default)
  --all                every non-errored photo (use to recover a prune)
  --photo-ids 1,2,3    just these photos

Dry-run by default — prints what it *would* add. Pass --apply to write.

Run from the backend dir with the project venv::

    cd backend && .venv/bin/python scripts/reanalyze_faces.py --all          # preview
    cd backend && .venv/bin/python scripts/reanalyze_faces.py --all --apply   # rebuild
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make ``app`` importable when run as a script from the backend dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select  # noqa: E402

from app.analyzer import detect_faces  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Face, Photo  # noqa: E402
from app.scanner import (  # noqa: E402
    UnreadableImageError,
    load_image,
    make_face_thumbnail,
)

# A detected face this close to an existing one is treated as the same face.
IOU_SAME = 0.5


def _iou(a: list[float], b: list[float]) -> float:
    """Intersection-over-union of two [x1, y1, x2, y2] boxes."""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _select_photo_ids(session, args) -> list[int]:
    if args.photo_ids:
        return [int(x) for x in args.photo_ids.split(",") if x.strip()]
    if args.all:
        return list(
            session.execute(
                select(Photo.id).where(Photo.error.is_(None)).order_by(Photo.id)
            ).scalars().all()
        )
    # default: --missing — photos with no faces
    face_count = (
        select(func.count()).select_from(Face).where(Face.photo_id == Photo.id).correlate(Photo).scalar_subquery()
    )
    return list(
        session.execute(
            select(Photo.id).where(Photo.error.is_(None), face_count == 0).order_by(Photo.id)
        ).scalars().all()
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--missing", action="store_true", help="photos with zero faces (default)")
    g.add_argument("--all", action="store_true", help="every non-errored photo")
    ap.add_argument("--photo-ids", type=str, default="", help="comma-separated photo ids")
    ap.add_argument("--apply", action="store_true", help="actually write (default: dry-run)")
    args = ap.parse_args()

    session = SessionLocal()
    added = 0
    scanned = 0
    skipped: list[tuple[int, str]] = []
    try:
        photo_ids = _select_photo_ids(session, args)
        print(f"Re-detecting faces across {len(photo_ids)} photo(s)…")

        for n, pid in enumerate(photo_ids, start=1):
            photo = session.get(Photo, pid)
            if photo is None or not photo.path:
                skipped.append((pid, "no photo row/path"))
                continue
            if not Path(photo.path).is_file():
                skipped.append((pid, f"missing file: {photo.path}"))
                continue
            try:
                img = load_image(photo.path)
            except UnreadableImageError as exc:
                skipped.append((pid, f"unreadable: {exc}"))
                continue

            scanned += 1
            existing = [
                list(b)
                for b in session.execute(
                    select(Face.bbox).where(Face.photo_id == pid)
                ).scalars().all()
            ]
            for det in detect_faces(img):
                bbox = det["bbox"]
                if any(_iou(bbox, e) >= IOU_SAME for e in existing):
                    continue  # already present — don't duplicate a kept face
                added += 1
                existing.append(bbox)
                if not args.apply:
                    continue
                face_row = Face(photo_id=pid, bbox=bbox, det_score=det["det_score"], vec=det["vec"].tolist())
                session.add(face_row)
                session.flush()  # assigns id for the crop filename
                thumb = make_face_thumbnail(img, bbox, settings.thumb_dir, face_row.id)
                face_row.thumb_path = str(thumb)
                face_row.thumb_data = Path(thumb).read_bytes()

            if args.apply and n % 50 == 0:
                session.commit()
            if n % 200 == 0:
                print(f"  …{n}/{len(photo_ids)} photos, {added} face(s) {'added' if args.apply else 'to add'}")

        if args.apply:
            session.commit()
    finally:
        session.close()

    verb = "Added" if args.apply else "Would add"
    print(f"\n{verb} {added} face(s) across {scanned} readable photo(s); {len(skipped)} skipped.")
    if skipped:
        print("Skipped (photo_id: reason):")
        for pid, reason in skipped[:50]:
            print(f"  {pid}: {reason}")
        if len(skipped) > 50:
            print(f"  … and {len(skipped) - 50} more")
    if added and args.apply:
        print("\nRestored faces are unclustered — run POST /cluster to (re)assign them to people.")
    elif not args.apply:
        print("Dry-run only. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
