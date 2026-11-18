"""Albums API: user-named collections of photos (many-to-many).

A pure DB surface — lives on the slim ``api`` service alongside persons/sim, so
albums can be created, browsed and curated even in no-worker deployments. Photos
are added to an album either here (manual add) or by a scan targeting the album.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Album, Photo, PhotoAlbum
from app.schemas import AlbumCreate, AlbumOut, AlbumPhotosRequest

router = APIRouter()


def get_or_create_album(session: Session, name: str) -> Album:
    """Return the album named ``name``, creating it if it does not exist.

    Shared with the scan pipeline so "scan into album X" and manual creation
    converge on one row. Names are matched case-insensitively and trimmed.
    """
    clean = name.strip()
    album = session.execute(
        select(Album).where(func.lower(Album.name) == clean.lower())
    ).scalar_one_or_none()
    if album is None:
        album = Album(name=clean, created_at=datetime.now(timezone.utc))
        session.add(album)
        session.flush()
    return album


def _album_out(session: Session, album: Album) -> AlbumOut:
    """Serialize one album with its photo count and a cover photo."""
    count = session.execute(
        select(func.count())
        .select_from(PhotoAlbum)
        .where(PhotoAlbum.album_id == album.id)
    ).scalar_one()
    cover = session.execute(
        select(Photo.id, Photo.drive_file_id)
        .join(PhotoAlbum, PhotoAlbum.photo_id == Photo.id)
        .where(PhotoAlbum.album_id == album.id, Photo.error.is_(None))
        .order_by(Photo.id.asc())
        .limit(1)
    ).first()
    return AlbumOut(
        id=album.id,
        name=album.name,
        photo_count=count,
        cover_photo_id=cover[0] if cover else None,
        cover_drive_file_id=cover[1] if cover else None,
    )


@router.get("/albums", response_model=list[AlbumOut])
def list_albums(session: Session = Depends(get_session)) -> list[AlbumOut]:
    """All albums, newest first, each with photo count + cover photo."""
    albums = (
        session.execute(select(Album).order_by(Album.id.desc())).scalars().all()
    )
    return [_album_out(session, a) for a in albums]


@router.get("/photos/{photo_id}/albums", response_model=list[AlbumOut])
def photo_albums(
    photo_id: int, session: Session = Depends(get_session)
) -> list[AlbumOut]:
    """The albums a single photo belongs to (newest first).

    Lets the viewer show which albums already contain the photo, so the
    "Add to album" menu can mark membership and toggle it instead of only ever
    adding.
    """
    albums = (
        session.execute(
            select(Album)
            .join(PhotoAlbum, PhotoAlbum.album_id == Album.id)
            .where(PhotoAlbum.photo_id == photo_id)
            .order_by(Album.id.desc())
        )
        .scalars()
        .all()
    )
    return [_album_out(session, a) for a in albums]


@router.post("/albums", response_model=AlbumOut)
def create_album(
    body: AlbumCreate, session: Session = Depends(get_session)
) -> AlbumOut:
    """Create (or return the existing) album with the given name."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="album name is required")
    album = get_or_create_album(session, body.name)
    session.commit()
    return _album_out(session, album)


@router.patch("/albums/{album_id}", response_model=AlbumOut)
def rename_album(
    album_id: int, body: AlbumCreate, session: Session = Depends(get_session)
) -> AlbumOut:
    """Rename an album."""
    album = session.get(Album, album_id)
    if album is None:
        raise HTTPException(status_code=404, detail="album not found")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="album name is required")
    album.name = body.name.strip()
    session.commit()
    return _album_out(session, album)


@router.delete("/albums/{album_id}")
def delete_album(
    album_id: int, session: Session = Depends(get_session)
) -> dict[str, bool]:
    """Delete an album and its membership rows (photos themselves are kept)."""
    album = session.get(Album, album_id)
    if album is None:
        raise HTTPException(status_code=404, detail="album not found")
    session.execute(delete(PhotoAlbum).where(PhotoAlbum.album_id == album_id))
    session.delete(album)
    session.commit()
    return {"deleted": True}


@router.post("/albums/{album_id}/photos", response_model=AlbumOut)
def add_photos(
    album_id: int,
    body: AlbumPhotosRequest,
    session: Session = Depends(get_session),
) -> AlbumOut:
    """Add photos to an album, ignoring ones already in it."""
    album = session.get(Album, album_id)
    if album is None:
        raise HTTPException(status_code=404, detail="album not found")
    add_photos_to_album(session, album_id, body.photo_ids)
    session.commit()
    return _album_out(session, album)


@router.delete("/albums/{album_id}/photos", response_model=AlbumOut)
def remove_photos(
    album_id: int,
    body: AlbumPhotosRequest,
    session: Session = Depends(get_session),
) -> AlbumOut:
    """Remove photos from an album (the photos themselves are kept)."""
    album = session.get(Album, album_id)
    if album is None:
        raise HTTPException(status_code=404, detail="album not found")
    if body.photo_ids:
        session.execute(
            delete(PhotoAlbum).where(
                PhotoAlbum.album_id == album_id,
                PhotoAlbum.photo_id.in_(body.photo_ids),
            )
        )
    session.commit()
    return _album_out(session, album)


def add_photos_to_album(
    session: Session, album_id: int, photo_ids: list[int]
) -> None:
    """Insert membership rows, skipping any that already exist.

    Shared by the manual add endpoint and the scan pipeline. Does not commit.
    """
    if not photo_ids:
        return
    existing = set(
        session.execute(
            select(PhotoAlbum.photo_id).where(
                PhotoAlbum.album_id == album_id,
                PhotoAlbum.photo_id.in_(photo_ids),
            )
        )
        .scalars()
        .all()
    )
    fresh = [pid for pid in dict.fromkeys(photo_ids) if pid not in existing]
    if fresh:
        session.execute(
            insert(PhotoAlbum),
            [{"photo_id": pid, "album_id": album_id} for pid in fresh],
        )
