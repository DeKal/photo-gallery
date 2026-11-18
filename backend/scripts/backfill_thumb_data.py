"""Backfill ``thumb_data`` (in-DB thumbnail bytes) from on-disk thumbnails.

For libraries scanned before in-DB thumbnails existed: read each row's
``thumb_path`` file and store its bytes in ``thumb_data`` so media can be served
with no shared filesystem (serverless/Vercel). Run this on the host where the
thumbnail files live (your Mac), then dump/load the DB to the prod Postgres.

Covers both ``photos`` and ``faces``. Idempotent: only rows with a NULL
``thumb_data`` and an existing ``thumb_path`` file are touched.

Usage:
    .venv/bin/python -m scripts.backfill_thumb_data [--apply]

Without ``--apply`` it prints a dry-run report and changes nothing.
"""

from __future__ import annotations

import argparse
import os

from app.db import SessionLocal
from app.models import Face, Photo


def _backfill(session, model, label: str, apply: bool) -> None:
    rows = (
        session.query(model)
        .filter(model.thumb_data.is_(None), model.thumb_path.isnot(None))
        .all()
    )
    filled = missing = 0
    for row in rows:
        if not os.path.isfile(row.thumb_path):
            missing += 1
            continue
        if apply:
            with open(row.thumb_path, "rb") as fh:
                row.thumb_data = fh.read()
        filled += 1
    print(
        f"{label}: {len(rows)} without bytes; "
        f"{'filled' if apply else 'would fill'} {filled}; "
        f"missing file {missing}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write changes (default: dry-run report only)",
    )
    args = parser.parse_args()

    session = SessionLocal()
    try:
        _backfill(session, Photo, "photos", args.apply)
        _backfill(session, Face, "faces", args.apply)
        if args.apply:
            session.commit()
            print("committed.")
        else:
            print("dry run — re-run with --apply to write.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
