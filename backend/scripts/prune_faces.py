"""Prune each person's faces down to the top-N by measured image quality.

The detector's ``det_score`` is only a confidence that a face is present — it
says nothing about whether the crop is sharp, large, or well exposed. This
script opens every stored face crop (``faces.thumb_data``) and computes a real
quality score, then keeps the best N faces per person and deletes the rest to
reclaim DB space.

Quality score (normalised per person, then weighted):
  - sharpness  — variance of the Laplacian of the crop (blurry = low)   [0.50]
  - face size  — bbox area in the original image (more pixels = detail) [0.30]
  - det_score  — detector confidence                                     [0.20]

Always kept, regardless of rank:
  - the person's currently selected cover face (``persons.cover_face_id``)

Not touched:
  - orphan faces not clustered to any person (this is a per-person trim)

Dry-run by default — prints what it *would* delete. Pass ``--apply`` to delete.

Run from the backend dir with the project venv::

    cd backend && .venv/bin/python scripts/prune_faces.py            # preview
    cd backend && .venv/bin/python scripts/prune_faces.py --apply    # delete
    cd backend && .venv/bin/python scripts/prune_faces.py --keep 30 --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

# Make ``app`` importable when run as a script from the backend dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Face, FacePerson, Person  # noqa: E402

# Score weights (must sum to 1.0).
W_SHARP = 0.50
W_AREA = 0.30
W_DET = 0.20


def _sharpness(thumb: bytes | None) -> float:
    """Variance of the Laplacian of the crop — higher means sharper."""
    if not thumb:
        return 0.0
    arr = np.frombuffer(thumb, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return float(cv2.Laplacian(img, cv2.CV_64F).var())


def _area(bbox: list[float] | None) -> float:
    """Face bbox area in original-image pixels (x1, y1, x2, y2)."""
    if not bbox or len(bbox) < 4:
        return 0.0
    w = max(0.0, float(bbox[2]) - float(bbox[0]))
    h = max(0.0, float(bbox[3]) - float(bbox[1]))
    return w * h


def _norm(values: list[float]) -> list[float]:
    """Min-max normalise to [0, 1]; a flat set maps to 0.5 (no signal)."""
    lo, hi = min(values), max(values)
    if hi <= lo:
        return [0.5] * len(values)
    span = hi - lo
    return [(v - lo) / span for v in values]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--keep", type=int, default=50, help="faces to keep per person (default 50)")
    ap.add_argument("--apply", action="store_true", help="actually delete (default: dry-run)")
    args = ap.parse_args()
    keep = args.keep

    session = SessionLocal()
    to_delete: list[int] = []
    bytes_freed = 0
    persons_trimmed = 0
    try:
        person_ids = session.execute(
            select(FacePerson.person_id).distinct()
        ).scalars().all()
        print(f"Scanning {len(person_ids)} person cluster(s), keeping top {keep} each…")

        for n, pid in enumerate(person_ids, start=1):
            person = session.get(Person, pid)
            cover = person.cover_face_id if person else None

            rows = session.execute(
                select(Face.id, Face.det_score, Face.bbox, Face.thumb_data)
                .join(FacePerson, FacePerson.face_id == Face.id)
                .where(FacePerson.person_id == pid)
            ).all()
            if len(rows) <= keep:
                continue

            sharp = _norm([_sharpness(r.thumb_data) for r in rows])
            area = _norm([_area(r.bbox) for r in rows])
            det = _norm([float(r.det_score or 0.0) for r in rows])
            scored = [
                (
                    rows[i].id,
                    W_SHARP * sharp[i] + W_AREA * area[i] + W_DET * det[i],
                    float(rows[i].det_score or 0.0),
                    len(rows[i].thumb_data or b""),
                )
                for i in range(len(rows))
            ]
            # Best first; keep the cover face no matter where it ranks.
            scored.sort(key=lambda t: (t[1], t[2], t[0]), reverse=True)
            kept = 0
            trimmed_here = 0
            for face_id, _score, _det, nbytes in scored:
                if face_id == cover:
                    continue  # always kept, outside the quota
                if kept < keep:
                    kept += 1
                    continue
                to_delete.append(face_id)
                bytes_freed += nbytes
                trimmed_here += 1
            if trimmed_here:
                persons_trimmed += 1

            if n % 25 == 0:
                print(f"  …{n}/{len(person_ids)} clusters scanned, {len(to_delete)} marked")

        print(
            f"\n{persons_trimmed} cluster(s) over quota. "
            f"Would delete {len(to_delete)} face(s), freeing ~{bytes_freed / 1_048_576:.0f} MB of crops."
        )

        if not to_delete:
            print("Nothing to do.")
            return 0

        if not args.apply:
            print("Dry-run only. Re-run with --apply to delete.")
            return 0

        # Drop membership links first (FK), then the faces. Cover faces are
        # never in `to_delete`, so persons.cover_face_id stays valid.
        deleted = 0
        for i in range(0, len(to_delete), 500):
            batch = to_delete[i : i + 500]
            session.execute(delete(FacePerson).where(FacePerson.face_id.in_(batch)))
            session.execute(delete(Face).where(Face.id.in_(batch)))
            session.commit()
            deleted += len(batch)
            print(f"  deleted {deleted}/{len(to_delete)}…")

        print(f"\nDone. Deleted {deleted} face(s).")
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
