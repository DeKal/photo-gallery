"""Worker entrypoint: the ML + media surface, run natively on the host.

This app owns everything that needs the heavy models, the local filesystem, or
the host OS: the scan pipeline (CLIP + InsightFace embedding), clustering
(DBSCAN/HDBSCAN), the native folder picker, and serving thumbnail/original image
files. It is meant to run as a native process (not in Docker) so CLIP keeps the
Apple-Silicon MPS device and so it can read the user's photo library directly.

The light, DB-only surface (persons, similarity) lives in ``app.main_api``; the
combined all-in-one app for simple local dev is still ``app.main``.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.cluster import router as cluster_router
from app.api.media import router as media_router
from app.api.scan import router as scan_router

app = FastAPI(title="photo-worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(scan_router)
app.include_router(cluster_router)
app.include_router(media_router)
