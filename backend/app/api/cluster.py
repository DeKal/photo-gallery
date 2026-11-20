"""Clustering API: group faces into persons and images into similarity clusters."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.clusterer import cluster_faces, cluster_images
from app.auth import require_admin
from app.db import get_session

router = APIRouter()


@router.post("/cluster")
def run_clustering(
    session: Session = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict[str, dict]:
    """Re-cluster all faces and images, returning a combined summary."""
    faces = cluster_faces(session)
    images = cluster_images(session)
    return {"faces": faces, "images": images}
