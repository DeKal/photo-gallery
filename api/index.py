"""Vercel serverless entry for the DB-only API (no ML worker).

Serves the slim ``app.main_api`` (persons, similarity, photos, and in-DB
thumbnails) mounted under ``/api``, so one Vercel project can host the SPA at
``/`` and this API at ``/api/*`` on a single origin (no CORS). The ML worker
(scan / cluster / folder picker / original images) is intentionally not
deployed here.
"""

import os
import sys

# Short-lived invocations + Neon's own pooling mean this app must keep no
# connection pool of its own; force the NullPool engine (see app/db.py).
os.environ.setdefault("PHOTO_SERVERLESS", "1")

# The backend package lives in ../backend, outside this function's directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi import FastAPI  # noqa: E402  (import after sys.path setup)

from app.main_api import app as api_app  # noqa: E402

app = FastAPI()
# Mount under /api so /api/persons -> /persons inside the slim app, matching the
# frontend's VITE_API_BASE=/api.
app.mount("/api", api_app)
