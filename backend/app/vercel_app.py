"""Vercel entry for the merged ``backend`` service (slim, DB-only; no worker).

On Vercel the ``backend`` service runs this ASGI app: the light
``app.main_api`` (persons, similarity, photos, albums, in-DB thumbnails)
mounted under ``/api`` so the SPA at ``/`` and the API at ``/api/*`` share one
origin (no CORS). Services receive the original request path (Vercel does not
strip the rewrite prefix), so ``/api/persons`` arrives here as ``/api/persons``
and the mount turns it into ``/persons`` inside ``main_api``.

Only ``app.main_api`` is imported, which pulls none of the ML stack
(torch/open_clip/insightface/onnxruntime) or Pillow -- the heavy worker
(``app.main_worker``) is never deployed to Vercel; it runs natively on a host.
Mode is chosen by entrypoint + installed deps, not auto-detected: Vercel installs
the slim ``requirements.txt`` and runs this; local installs ``.[worker]`` and
runs the worker.
"""

import os

# Short-lived invocations + the managed DB (Neon) pooling connections itself
# mean this app must keep no connection pool of its own; force NullPool (db.py).
os.environ.setdefault("PHOTO_SERVERLESS", "1")

from fastapi import FastAPI  # noqa: E402  (import after env setup)

from app.main_api import app as api_app  # noqa: E402

app = FastAPI()
app.mount("/api", api_app)
