"""Backfill ``photos.drive_file_id`` from a public Google Drive folder.

For libraries that were scanned from local files *before* Drive support existed:
enumerate a public ("anyone with the link") Drive folder, match each Drive file
to an existing ``Photo`` row by file name (basename), and record the Drive file
id on that row. No files are downloaded — only the folder listing is read.

Matching is by basename, which is safe only when names are unique on both sides;
the script refuses to run if it finds duplicate basenames (in the DB or the
folder) to avoid mis-linking. It is idempotent: re-running sets the same ids.

Usage:
    .venv/bin/python -m scripts.backfill_drive_ids <drive_folder_url> [--apply]

Without ``--apply`` it prints a dry-run report and changes nothing.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

import gdown

from app.db import SessionLocal
from app.models import Photo


def _basename_map(names: list[str], label: str) -> dict[str, int]:
    dups = [n for n, c in Counter(names).items() if c > 1]
    if dups:
        sys.exit(
            f"refusing to run: {len(dups)} duplicate basename(s) in {label}; "
            f"basename matching would be ambiguous (e.g. {dups[:5]})"
        )
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="public Google Drive folder URL")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write changes (default: dry-run report only)",
    )
    args = parser.parse_args()

    listing = (
        gdown.download_folder(
            url=args.url, skip_download=True, quiet=True, use_cookies=False
        )
        or []
    )
    drive_names = [os.path.basename(e.path) for e in listing]
    _basename_map(drive_names, "the Drive folder")
    drive = {os.path.basename(e.path): e.id for e in listing}
    print(f"Drive folder: {len(drive)} files")

    session = SessionLocal()
    try:
        photos = session.query(Photo).all()
        _basename_map([os.path.basename(p.path) for p in photos], "the database")

        matched = updated = unchanged = 0
        for photo in photos:
            file_id = drive.get(os.path.basename(photo.path))
            if file_id is None:
                continue
            matched += 1
            if photo.drive_file_id == file_id:
                unchanged += 1
                continue
            if args.apply:
                photo.drive_file_id = file_id
            updated += 1

        drive_only = sum(
            1 for n in drive if n not in {os.path.basename(p.path) for p in photos}
        )
        print(f"DB photos: {len(photos)}")
        print(f"matched by name: {matched}")
        print(f"  already linked: {unchanged}")
        print(f"  {'updated' if args.apply else 'would update'}: {updated}")
        print(f"Drive files with no DB photo: {drive_only}")

        if args.apply:
            session.commit()
            print("committed.")
        else:
            print("dry run — re-run with --apply to write.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
