#!/usr/bin/env python3
"""Seed (or update) a login account in the DB.

Usage:
    python scripts/seed_admin.py --username admin --password 'secret'

Credentials may also come from ADMIN_USERNAME / ADMIN_PASSWORD env vars. The
password is stored only as a PBKDF2-SHA256 hash. Point PHOTO_DATABASE_URL at the
target DB (local, or the Neon *direct* URL for the Vercel deploy) before running.
Re-running with the same username updates that user's password (idempotent).
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running as `python scripts/seed_admin.py` from the repo root by putting
# the backend package on the path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.auth import hash_password  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed/update a login account.")
    parser.add_argument("--username", default=os.environ.get("ADMIN_USERNAME"))
    parser.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD"))
    args = parser.parse_args()

    if not args.username or not args.password:
        parser.error(
            "username and password required (flags or ADMIN_USERNAME/ADMIN_PASSWORD)"
        )

    with SessionLocal() as session:
        user = (
            session.query(User).filter(User.username == args.username).one_or_none()
        )
        if user is None:
            user = User(username=args.username, created_at=datetime.now(timezone.utc))
            session.add(user)
            action = "created"
        else:
            action = "updated"
        user.password_hash = hash_password(args.password)
        session.commit()

    print(f"{action} user {args.username!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
