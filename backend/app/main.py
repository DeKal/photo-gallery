from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.albums import router as albums_router
from app.api.cluster import router as cluster_router
from app.api.media import router as media_router
from app.api.persons import router as persons_router
from app.api.photos import router as photos_router
from app.api.scan import router as scan_router
from app.api.sim import router as sim_router

app = FastAPI(title="photo-backend")

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
app.include_router(persons_router)
app.include_router(sim_router)
app.include_router(photos_router)
app.include_router(albums_router)
app.include_router(media_router)
