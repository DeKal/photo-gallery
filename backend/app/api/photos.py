"""Photos API: a flat, paginated listing of the whole library (All Photos).

A pure DB read — lives on the slim ``api`` service alongside persons/sim.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.permissions import gate
from app.models import Face, FacePerson, Person, Photo, PhotoAlbum
from app.schemas import (
    FavoriteOut,
    FavoriteRequest,
    PhotoFace,
    PhotoFacesOut,
    PhotoListItem,
    PhotoListOut,
    PhotoPerson,
)

router = APIRouter()

MAX_LIMIT = 500


@router.get("/photos", response_model=PhotoListOut)
def list_photos(
    limit: int = Query(default=100, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    order: str = Query(default="newest", pattern="^(newest|oldest)$"),
    q: str | None = Query(default=None),
    album: int | None = Query(default=None),
    favorites: bool = Query(default=False),
    session: Session = Depends(get_session),
) -> PhotoListOut:
    """A page of successfully-indexed photos plus the total count.

    Ordered by capture time (``taken_at``, falling back to ``scanned_at``);
    ``newest`` first by default. Photos that failed to process (``error`` set)
    are excluded. Each item carries ``face_count`` (faces detected) and the
    ``persons`` those faces clustered into (id + name) so the UI can tag who is
    in a photo and link straight to each person for cross-checking.

    ``q`` filters the whole library by file path **or** the name of any person
    present in the photo (case-insensitive substring). ``album`` restricts the
    listing to photos belonging to that album. ``favorites`` restricts it to
    starred photos.
    """
    conds = [Photo.error.is_(None)]
    if favorites:
        conds.append(Photo.favorite.is_(True))
    if album is not None:
        conds.append(
            select(PhotoAlbum.photo_id)
            .where(
                PhotoAlbum.photo_id == Photo.id,
                PhotoAlbum.album_id == album,
            )
            .correlate(Photo)
            .exists()
        )
    if q and q.strip():
        like = f"%{q.strip()}%"
        person_match = (
            select(Face.id)
            .join(FacePerson, FacePerson.face_id == Face.id)
            .join(Person, Person.id == FacePerson.person_id)
            .where(Face.photo_id == Photo.id, Person.name.ilike(like), Person.hidden.is_(False))
            .correlate(Photo)
            .exists()
        )
        conds.append(or_(Photo.path.ilike(like), person_match))
    where = and_(*conds)

    total = session.execute(
        select(func.count()).select_from(Photo).where(where)
    ).scalar_one()

    sort_key = func.coalesce(Photo.taken_at, Photo.scanned_at)
    ordering = (
        (sort_key.asc().nulls_last(), Photo.id.asc())
        if order == "oldest"
        else (sort_key.desc().nulls_last(), Photo.id.desc())
    )

    face_count = (
        select(func.count())
        .select_from(Face)
        .where(Face.photo_id == Photo.id)
        .correlate(Photo)
        .scalar_subquery()
    )

    rows = session.execute(
        select(Photo, face_count)
        .where(where)
        .order_by(*ordering)
        .limit(limit)
        .offset(offset)
    ).all()

    photo_ids = [p.id for p, _ in rows]

    # Persons present in each photo (distinct, via faces -> face_person).
    persons_by_photo: dict[int, dict[int, str | None]] = {}
    if photo_ids:
        pp = session.execute(
            select(Face.photo_id, Person.id, Person.name)
            .join(FacePerson, FacePerson.face_id == Face.id)
            .join(Person, Person.id == FacePerson.person_id)
            .where(Face.photo_id.in_(photo_ids), Person.hidden.is_(False))
        ).all()
        for photo_id, person_id, name in pp:
            persons_by_photo.setdefault(photo_id, {})[person_id] = name

    items = []
    for p, faces in rows:
        pmap = persons_by_photo.get(p.id, {})
        persons = [PhotoPerson(id=pid, name=name) for pid, name in pmap.items()]
        # Named first, then by id for a stable order.
        persons.sort(key=lambda x: (x.name is None, x.name or "", x.id))
        items.append(
            PhotoListItem(
                id=p.id,
                path=p.path,
                thumb_path=p.thumb_path,
                width=p.width,
                height=p.height,
                taken_at=p.taken_at,
                drive_file_id=p.drive_file_id,
                face_count=faces,
                person_count=len(persons),
                persons=persons,
                favorite=p.favorite,
            )
        )
    return PhotoListOut(total=total, items=items)


@router.get("/photos/{photo_id}/persons", response_model=list[PhotoPerson])
def photo_persons(
    photo_id: int, session: Session = Depends(get_session)
) -> list[PhotoPerson]:
    """The distinct persons present in a single photo (named first).

    Lets any image viewer show who is in the photo and link to them, without
    threading the data through the page listing.
    """
    rows = session.execute(
        select(Person.id, Person.name)
        .join(FacePerson, FacePerson.person_id == Person.id)
        .join(Face, Face.id == FacePerson.face_id)
        .where(Face.photo_id == photo_id, Person.hidden.is_(False))
        .distinct()
    ).all()
    persons = [PhotoPerson(id=pid, name=name) for pid, name in rows]
    persons.sort(key=lambda x: (x.name is None, x.name or "", x.id))
    return persons


@router.get("/photos/{photo_id}/faces", response_model=PhotoFacesOut)
def photo_faces(
    photo_id: int, session: Session = Depends(get_session)
) -> PhotoFacesOut:
    """Detected face boxes in a single photo, for position tags in the viewer.

    Returns each face's ``bbox`` (original pixel coords) plus the photo's
    ``width``/``height`` so the UI can place the box as a percentage over the
    displayed image. A face that clustered into a non-hidden person carries that
    ``person_id``/``person_name`` (clickable); unassigned faces carry a box with
    no link. Faces belonging to a hidden person are omitted entirely, matching
    the person-tag listing.
    """
    photo = session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="photo not found")

    # Faces pinned to a hidden person are suppressed (the user hid that person).
    hidden_face_ids = (
        select(FacePerson.face_id)
        .join(Person, Person.id == FacePerson.person_id)
        .where(Person.hidden.is_(True))
    )
    rows = session.execute(
        select(Face.id, Face.bbox, Person.id, Person.name)
        .select_from(Face)
        .outerjoin(FacePerson, FacePerson.face_id == Face.id)
        .outerjoin(Person, Person.id == FacePerson.person_id)
        .where(Face.photo_id == photo_id, Face.id.not_in(hidden_face_ids))
        .order_by(Face.id)
    ).all()

    faces = [
        PhotoFace(
            id=fid,
            bbox=[float(v) for v in bbox],
            person_id=pid,
            person_name=name,
        )
        for fid, bbox, pid, name in rows
        if bbox is not None and len(bbox) >= 4
    ]
    return PhotoFacesOut(width=photo.width, height=photo.height, faces=faces)


@router.get("/photos/{photo_id}/favorite", response_model=FavoriteOut)
def get_favorite(
    photo_id: int, session: Session = Depends(get_session)
) -> FavoriteOut:
    """Whether a single photo is starred (for the lightbox star state)."""
    photo = session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="photo not found")
    return FavoriteOut(id=photo.id, favorite=photo.favorite)


@router.put("/photos/{photo_id}/favorite", response_model=FavoriteOut)
def set_favorite(
    photo_id: int,
    body: FavoriteRequest,
    session: Session = Depends(get_session),
    _: str = Depends(gate("photo.favorite")),
) -> FavoriteOut:
    """Star or unstar a photo."""
    photo = session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="photo not found")
    photo.favorite = body.favorite
    session.commit()
    return FavoriteOut(id=photo.id, favorite=photo.favorite)
