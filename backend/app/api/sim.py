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
    PhotoAlbum,
    PhotoSimCluster,
    SimCluster,
)
from app.schemas import PhotoOut, SimClusterOut, SimilarPhoto

router = APIRouter()

MAX_K = 500


@router.get("/sim-clusters", response_model=list[SimClusterOut])
def list_sim_clusters(
    album: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[SimClusterOut]:
    """List similarity clusters, ordered by photo count descending.

    Each cluster carries the distinct names of people appearing in any of its
    photos, so the UI can filter whole groups by person name. When ``album`` is
    given, only clusters with a photo in that album appear, and their counts,
    covers and names are scoped to the album's photos.
    """
    count_stmt = select(
        SimCluster.id,
        SimCluster.label,
        func.min(PhotoSimCluster.photo_id),
        func.count(PhotoSimCluster.photo_id),
    ).join(
        PhotoSimCluster,
        PhotoSimCluster.sim_cluster_id == SimCluster.id,
    )
    if album is not None:
        count_stmt = count_stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == PhotoSimCluster.photo_id
        ).where(PhotoAlbum.album_id == album)
    rows = session.execute(
        count_stmt.group_by(SimCluster.id, SimCluster.label).order_by(
            func.count(PhotoSimCluster.photo_id).desc()
        )
    ).all()

    # Distinct named people per cluster (across its photos, scoped to album).
    name_stmt = (
        select(PhotoSimCluster.sim_cluster_id, Person.name)
        .join(Face, Face.photo_id == PhotoSimCluster.photo_id)
        .join(FacePerson, FacePerson.face_id == Face.id)
        .join(Person, Person.id == FacePerson.person_id)
        .where(Person.name.is_not(None))
    )
    if album is not None:
        name_stmt = name_stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == PhotoSimCluster.photo_id
        ).where(PhotoAlbum.album_id == album)
    name_rows = session.execute(name_stmt.distinct()).all()
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
    cluster_id: int,
    album: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[Photo]:
    """Photos belonging to a similarity cluster, or 404 if it does not exist.

    When ``album`` is given, restricted to photos that are in the album.
    """
    if session.get(SimCluster, cluster_id) is None:
        raise HTTPException(status_code=404, detail="sim cluster not found")

    stmt = (
        select(Photo)
        .join(PhotoSimCluster, PhotoSimCluster.photo_id == Photo.id)
        .where(PhotoSimCluster.sim_cluster_id == cluster_id)
    )
    if album is not None:
        stmt = stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == Photo.id
        ).where(PhotoAlbum.album_id == album)
    photos = session.execute(stmt.order_by(Photo.id)).scalars().all()
    return list(photos)


@router.get("/photos/{photo_id}/similar", response_model=list[SimilarPhoto])
def similar_photos(
    photo_id: int,
    k: int = Query(default=50, ge=1, le=MAX_K),
    album: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[SimilarPhoto]:
    """Return the ``k`` nearest photos to ``photo_id`` by cosine distance.

    Excludes the query photo itself. 404 if the photo or its embedding is
    missing. Distance is the cosine distance (smaller = more similar). When
    ``album`` is given, only photos in that album are considered neighbours.
    """
    if session.get(Photo, photo_id) is None:
        raise HTTPException(status_code=404, detail="photo not found")

    query_vec = session.execute(
        select(ImageEmbedding.vec).where(ImageEmbedding.photo_id == photo_id)
    ).scalar_one_or_none()
    if query_vec is None:
        raise HTTPException(status_code=404, detail="photo embedding not found")

    distance = ImageEmbedding.vec.cosine_distance(query_vec)
    stmt = (
        select(
            ImageEmbedding.photo_id,
            distance,
            Photo.thumb_path,
            Photo.drive_file_id,
        )
        .join(Photo, Photo.id == ImageEmbedding.photo_id)
        .where(ImageEmbedding.photo_id != photo_id)
    )
    if album is not None:
        stmt = stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == ImageEmbedding.photo_id
        ).where(PhotoAlbum.album_id == album)
    rows = session.execute(stmt.order_by(distance).limit(k)).all()

    return [
        SimilarPhoto(
            photo_id=pid,
            distance=float(dist),
            thumb_path=thumb_path,
            drive_file_id=drive_file_id,
        )
        for pid, dist, thumb_path, drive_file_id in rows
    ]
