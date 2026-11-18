"""Similarity API: list similarity clusters and find nearest photos by embedding."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import (
    Face,
    FacePerson,
    ImageEmbedding,
    Person,
    Photo,
    PhotoSimCluster,
    SimCluster,
)
from app.schemas import PhotoOut, SimClusterOut, SimilarPhoto

router = APIRouter()

MAX_K = 500


@router.get("/sim-clusters", response_model=list[SimClusterOut])
def list_sim_clusters(
    session: Session = Depends(get_session),
) -> list[SimClusterOut]:
    """List similarity clusters, ordered by photo count descending.

    Each cluster carries the distinct names of people appearing in any of its
    photos, so the UI can filter whole groups by person name.
    """
    rows = session.execute(
        select(
            SimCluster.id,
            SimCluster.label,
            func.min(PhotoSimCluster.photo_id),
            func.count(PhotoSimCluster.photo_id),
        )
        .join(
            PhotoSimCluster,
            PhotoSimCluster.sim_cluster_id == SimCluster.id,
        )
        .group_by(SimCluster.id, SimCluster.label)
        .order_by(func.count(PhotoSimCluster.photo_id).desc())
    ).all()

    # Distinct named people per cluster (across all its photos).
    name_rows = session.execute(
        select(PhotoSimCluster.sim_cluster_id, Person.name)
        .join(Face, Face.photo_id == PhotoSimCluster.photo_id)
        .join(FacePerson, FacePerson.face_id == Face.id)
        .join(Person, Person.id == FacePerson.person_id)
        .where(Person.name.is_not(None))
        .distinct()
    ).all()
    names_by_cluster: dict[int, list[str]] = {}
    for cluster_id, name in name_rows:
        names_by_cluster.setdefault(cluster_id, []).append(name)
    for names in names_by_cluster.values():
        names.sort()

    return [
        SimClusterOut(
            id=cid,
            label=label,
            cover_photo_id=cover_photo_id,
            photo_count=photo_count,
            person_names=names_by_cluster.get(cid, []),
        )
        for cid, label, cover_photo_id, photo_count in rows
    ]


@router.get("/sim-clusters/{cluster_id}/photos", response_model=list[PhotoOut])
def list_sim_cluster_photos(
    cluster_id: int, session: Session = Depends(get_session)
) -> list[Photo]:
    """Photos belonging to a similarity cluster, or 404 if it does not exist."""
    if session.get(SimCluster, cluster_id) is None:
        raise HTTPException(status_code=404, detail="sim cluster not found")

    photos = (
        session.execute(
            select(Photo)
            .join(PhotoSimCluster, PhotoSimCluster.photo_id == Photo.id)
            .where(PhotoSimCluster.sim_cluster_id == cluster_id)
            .order_by(Photo.id)
        )
        .scalars()
        .all()
    )
    return list(photos)


@router.get("/photos/{photo_id}/similar", response_model=list[SimilarPhoto])
def similar_photos(
    photo_id: int,
    k: int = Query(default=50, ge=1, le=MAX_K),
    session: Session = Depends(get_session),
) -> list[SimilarPhoto]:
    """Return the ``k`` nearest photos to ``photo_id`` by cosine distance.

    Excludes the query photo itself. 404 if the photo or its embedding is
    missing. Distance is the cosine distance (smaller = more similar).
    """
    if session.get(Photo, photo_id) is None:
        raise HTTPException(status_code=404, detail="photo not found")

    query_vec = session.execute(
        select(ImageEmbedding.vec).where(ImageEmbedding.photo_id == photo_id)
    ).scalar_one_or_none()
    if query_vec is None:
        raise HTTPException(status_code=404, detail="photo embedding not found")

    distance = ImageEmbedding.vec.cosine_distance(query_vec)
    rows = session.execute(
        select(ImageEmbedding.photo_id, distance, Photo.thumb_path, Photo.drive_file_id)
        .join(Photo, Photo.id == ImageEmbedding.photo_id)
        .where(ImageEmbedding.photo_id != photo_id)
        .order_by(distance)
        .limit(k)
    ).all()

    return [
        SimilarPhoto(
            photo_id=pid,
            distance=float(dist),
            thumb_path=thumb_path,
            drive_file_id=drive_file_id,
        )
        for pid, dist, thumb_path, drive_file_id in rows
    ]
