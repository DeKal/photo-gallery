"""API entrypoint: the light, DB-only surface, run in a slim Docker container.

This app serves pure Postgres reads/writes — persons and similarity clusters,
plus thumbnails/face crops now stored in-DB — and pulls none of the ML stack
(no torch/open_clip/insightface/sklearn/hdbscan) or Pillow. Its routers touch
only ``db``/``models``/``schemas``, so the container image stays small and
portable (and runs serverless, e.g. on Vercel, with no shared filesystem).

The heavy ML + original-image surface lives in ``app.main_worker`` (native
host); the combined all-in-one app for simple local dev is ``app.main``.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.albums import router as albums_router
from app.api.auth import router as auth_router
from app.api.media import router as media_router
from app.api.persons import router as persons_router
from app.api.photos import router as photos_router
from app.api.sim import router as sim_router

app = FastAPI(title="photo-api")

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


app.include_router(persons_router)
app.include_router(sim_router)
app.include_router(photos_router)
app.include_router(albums_router)
app.include_router(media_router)
app.include_router(auth_router)
