"""Backfill ``faces.sharpness`` for faces indexed before migration 008.

Computes the focus measure (variance of the Laplacian over the grayscale crop)
from each face's stored ``thumb_data`` and writes it to the new column, so
clustering can drop blurry faces without decoding crops at cluster time.

Keyset-paginated and batched: it walks faces by id in chunks, loading the
deferred ``thumb_data`` only for the current batch, so it never opens 10k
connections and tolerates a dropped batch (just re-run — it resumes from the
first still-null row). Reads ``PHOTO_DATABASE_URL`` (or ``_NEON``).

Usage::

    cd backend && .venv/bin/python ../scripts/backfill_sharpness.py [--batch 300]
"""

from __future__ import annotations

import argparse
import io
import os
import sys

from PIL import Image
from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.scanner import image_sharpness  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=300)
    args = parser.parse_args()

    url = os.environ.get("PHOTO_DATABASE_URL_NEON") or os.environ.get(
        "PHOTO_DATABASE_URL"
    )
    if not url:
        raise SystemExit("set PHOTO_DATABASE_URL(_NEON)")
    engine = create_engine(url)

    done = 0
    last_id = 0
    while True:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, thumb_data FROM faces "
                    "WHERE sharpness IS NULL AND id > :last AND thumb_data IS NOT NULL "
                    "ORDER BY id LIMIT :lim"
                ),
                {"last": last_id, "lim": args.batch},
            ).fetchall()
            if not rows:
                break
            updates = []
            for fid, data in rows:
                last_id = fid
                try:
                    val = image_sharpness(Image.open(io.BytesIO(data)))
                except Exception:
                    val = None
                if val is not None:
                    updates.append({"id": fid, "s": val})
            if updates:
                conn.execute(
                    text("UPDATE faces SET sharpness = :s WHERE id = :id"),
                    updates,
                )
                conn.commit()
            done += len(rows)
            print(f"backfilled {done} (through id {last_id})", flush=True)

    with engine.connect() as conn:
        remaining = conn.execute(
            text("SELECT count(*) FROM faces WHERE sharpness IS NULL")
        ).scalar_one()
    print(f"done. faces still null (no thumb_data): {remaining}")


if __name__ == "__main__":
    main()
