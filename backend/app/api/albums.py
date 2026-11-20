"""Albums API: user-named collections of photos (one album per photo).

A pure DB surface — lives on the slim ``api`` service alongside persons/sim, so
albums can be created, browsed and curated even in no-worker deployments. Photos
are added to an album either here (manual add) or by a scan targeting the album.
A photo belongs to exactly one album; adding it to another moves it.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, insert, select, text, tuple_
from sqlalchemy.orm import Session

from app.db import get_session
from app.permissions import gate
from app.models import Album, Photo, PhotoAlbum
from app.schemas import (
    AlbumCoverRequest,
    AlbumCreate,
    AlbumOut,
    AlbumPhotosRequest,
)

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
    """Serialize one album with its photo count and a cover photo.

    Cover preference: the album's stored ``cover_photo_id`` when it is still a
    (non-errored) member, otherwise the first member photo by id — so an album
    always shows a real cover even before one is chosen.
    """
    count = session.execute(
        select(func.count())
        .select_from(PhotoAlbum)
        .where(PhotoAlbum.album_id == album.id)
    ).scalar_one()

    cover = None
    if album.cover_photo_id is not None:
        cover = session.execute(
            select(Photo.id, Photo.drive_file_id)
            .join(PhotoAlbum, PhotoAlbum.photo_id == Photo.id)
            .where(
                PhotoAlbum.album_id == album.id,
                Photo.id == album.cover_photo_id,
                Photo.error.is_(None),
            )
            .limit(1)
        ).first()
    if cover is None:
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
    """All albums, newest first, each with photo count + cover photo.

    Built from a fixed set of bulk queries (counts, valid stored covers,
    first-member fallbacks) rather than two per album, so it stays fast over a
    remote DB (Neon) as the number of albums grows.
    """
    albums = (
        session.execute(select(Album).order_by(Album.id.desc())).scalars().all()
    )
    if not albums:
        return []
    ids = [a.id for a in albums]

    # Photo count per album, one grouped query.
    counts = dict(
        session.execute(
            select(PhotoAlbum.album_id, func.count())
            .where(PhotoAlbum.album_id.in_(ids))
            .group_by(PhotoAlbum.album_id)
        ).all()
    )

    # Stored covers that are still a non-errored member of their album, one
    # query keyed on the (album, photo) pairs.
    stored_pairs = [
        (a.id, a.cover_photo_id)
        for a in albums
        if a.cover_photo_id is not None
    ]
    valid_cover: dict[int, tuple[int, str | None]] = {}
    if stored_pairs:
        rows = session.execute(
            select(PhotoAlbum.album_id, Photo.id, Photo.drive_file_id)
            .join(Photo, Photo.id == PhotoAlbum.photo_id)
            .where(
                Photo.error.is_(None),
                tuple_(PhotoAlbum.album_id, Photo.id).in_(stored_pairs),
            )
        ).all()
        valid_cover = {aid: (pid, drive) for aid, pid, drive in rows}

    # First non-errored member per album (fallback cover), one DISTINCT ON query.
    first_member = {
        aid: (pid, drive)
        for aid, pid, drive in session.execute(
            select(PhotoAlbum.album_id, Photo.id, Photo.drive_file_id)
            .join(Photo, Photo.id == PhotoAlbum.photo_id)
            .where(PhotoAlbum.album_id.in_(ids), Photo.error.is_(None))
            .order_by(PhotoAlbum.album_id, Photo.id.asc())
            .distinct(PhotoAlbum.album_id)
        ).all()
    }

    out = []
    for a in albums:
        cover = valid_cover.get(a.id) or first_member.get(a.id)
        out.append(
            AlbumOut(
                id=a.id,
                name=a.name,
                photo_count=counts.get(a.id, 0),
                cover_photo_id=cover[0] if cover else None,
                cover_drive_file_id=cover[1] if cover else None,
            )
        )
    return out


@router.get("/photos/{photo_id}/albums", response_model=list[AlbumOut])
def photo_albums(
    photo_id: int, session: Session = Depends(get_session)
) -> list[AlbumOut]:
    """The album a single photo belongs to (zero or one).

    A photo lives in exactly one album, so this returns a list of length 0 or 1.
    Lets the viewer mark the current album in the "Add to album" menu and move
    the photo by picking another.
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
    body: AlbumCreate,
    session: Session = Depends(get_session),
    _: str = Depends(gate("album.create")),
) -> AlbumOut:
    """Create (or return the existing) album with the given name."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="album name is required")
    album = get_or_create_album(session, body.name)
    session.commit()
    return _album_out(session, album)


@router.get("/albums/{album_id}", response_model=AlbumOut)
def get_album(
    album_id: int, session: Session = Depends(get_session)
) -> AlbumOut:
    """A single album's metadata (name, photo count, cover).

    Lets the album-detail view show its header instantly, without waiting on the
    full album list or the album's photos. One round trip to the DB (count +
    cover resolution folded into a single statement) so it stays snappy over a
    remote database (Neon).
    """
    row = session.execute(
        text(
            """
            SELECT a.id, a.name, a.cover_photo_id,
                   (SELECT count(*) FROM photo_album pa WHERE pa.album_id = a.id) AS cnt
            FROM albums a
            WHERE a.id = :aid
            """
        ),
        {"aid": album_id},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="album not found")

    return AlbumOut(
        id=row.id,
        name=row.name,
        photo_count=row.cnt,
        cover_photo_id=row.cover_photo_id,
        cover_drive_file_id=None,
    )


@router.patch("/albums/{album_id}", response_model=AlbumOut)
def rename_album(
    album_id: int,
    body: AlbumCreate,
    session: Session = Depends(get_session),
    _: str = Depends(gate("album.rename")),
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
    album_id: int,
    session: Session = Depends(get_session),
    _: str = Depends(gate("album.delete")),
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
    _: str = Depends(gate("album.add_photo")),
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
    _: str = Depends(gate("album.remove_photo")),
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


def _random_member_id(session: Session, album_id: int) -> int | None:
    """Return a random (non-errored) member photo id, or None if empty."""
    return session.execute(
        select(Photo.id)
        .join(PhotoAlbum, PhotoAlbum.photo_id == Photo.id)
        .where(PhotoAlbum.album_id == album_id, Photo.error.is_(None))
        .order_by(func.random())
        .limit(1)
    ).scalar_one_or_none()


@router.put("/albums/{album_id}/cover", response_model=AlbumOut)
def set_cover(
    album_id: int,
    body: AlbumCoverRequest,
    session: Session = Depends(get_session),
    _: str = Depends(gate("album.cover")),
) -> AlbumOut:
    """Set an album's cover photo.

    A given ``photo_id`` must be a member of the album; passing ``null`` picks a
    random member instead.
    """
    album = session.get(Album, album_id)
    if album is None:
        raise HTTPException(status_code=404, detail="album not found")

    if body.photo_id is not None:
        is_member = session.execute(
            select(PhotoAlbum.photo_id).where(
                PhotoAlbum.album_id == album_id,
                PhotoAlbum.photo_id == body.photo_id,
            )
        ).scalar_one_or_none()
        if is_member is None:
            raise HTTPException(
                status_code=400, detail="photo is not in this album"
            )
        album.cover_photo_id = body.photo_id
    else:
        album.cover_photo_id = _random_member_id(session, album_id)

    session.commit()
    return _album_out(session, album)


def add_photos_to_album(
    session: Session, album_id: int, photo_ids: list[int]
) -> None:
    """Move photos into an album, enforcing single-album membership.

    A photo belongs to exactly one album, so adding it here first removes it
    from any other album (move semantics). Shared by the manual add endpoint and
    the scan pipeline. Does not commit.
    """
    if not photo_ids:
        return
    ids = list(dict.fromkeys(photo_ids))
    # Drop these photos from every other album first — one album per photo.
    session.execute(
        delete(PhotoAlbum).where(
            PhotoAlbum.photo_id.in_(ids),
            PhotoAlbum.album_id != album_id,
        )
    )
    existing = set(
        session.execute(
            select(PhotoAlbum.photo_id).where(
                PhotoAlbum.album_id == album_id,
                PhotoAlbum.photo_id.in_(ids),
            )
        )
        .scalars()
        .all()
    )
    fresh = [pid for pid in ids if pid not in existing]
    if fresh:
        session.execute(
            insert(PhotoAlbum),
            [{"photo_id": pid, "album_id": album_id} for pid in fresh],
        )
    # Give a fresh album a real cover straight away: pick a random member once,
    # so the card isn't locked to photo #1. Leaves an existing choice untouched.
    album = session.get(Album, album_id)
    if album is not None and album.cover_photo_id is None:
        album.cover_photo_id = _random_member_id(session, album_id)
