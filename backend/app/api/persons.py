"""Persons API: list, rename, merge person clusters and move faces between them."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.orm import Session

from app.auth import optional_admin
from app.db import get_session
from app.permissions import gate, requires_admin
from app.models import Face, FacePerson, Person, Photo, PhotoAlbum
from app.schemas import (
    FaceOut,
    MergeRequest,
    MoveFacesRequest,
    PersonListOut,
    PersonOut,
    PhotoOut,
    RenameRequest,
    SetCoverRequest,
)

router = APIRouter()


def _face_count(
    session: Session, person_id: int, album_id: int | None = None
) -> int:
    """Number of faces assigned to ``person_id``.

    When ``album_id`` is given, counts only faces whose photo is in that album,
    so a person's size reflects the album being browsed rather than the library.
    """
    stmt = (
        select(func.count(func.distinct(FacePerson.face_id)))
        .select_from(FacePerson)
        .where(FacePerson.person_id == person_id)
    )
    if album_id is not None:
        stmt = stmt.join(Face, Face.id == FacePerson.face_id).join(
            PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
        ).where(PhotoAlbum.album_id == album_id)
    return session.execute(stmt).scalar_one()


def _cover_photo_id(
    session: Session, person: Person, album_id: int | None = None
) -> int | None:
    """Photo of the cover face if set, else a photo of any member face.

    When ``album_id`` is given, the chosen photo is constrained to the album, so
    an album card never shows a cover from outside the album.
    """
    if person.cover_face_id is not None:
        stmt = select(Face.photo_id).where(Face.id == person.cover_face_id)
        if album_id is not None:
            stmt = stmt.join(
                PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
            ).where(PhotoAlbum.album_id == album_id)
        photo_id = session.execute(stmt).scalar_one_or_none()
        if photo_id is not None:
            return photo_id

    stmt = (
        select(Face.photo_id)
        .join(FacePerson, FacePerson.face_id == Face.id)
        .where(FacePerson.person_id == person.id)
        .order_by(Face.id)
        .limit(1)
    )
    if album_id is not None:
        stmt = stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
        ).where(PhotoAlbum.album_id == album_id)
    return session.execute(stmt).scalar_one_or_none()


def _person_out(
    session: Session, person: Person, album_id: int | None = None
) -> PersonOut:
    """Build a ``PersonOut`` for ``person`` (one count + one cover query each).

    ``album_id`` scopes the count and cover to a single album when set.
    """
    return PersonOut(
        id=person.id,
        name=person.name,
        cover_face_id=person.cover_face_id,
        cover_photo_id=_cover_photo_id(session, person, album_id),
        face_count=_face_count(session, person.id, album_id),
        hidden=person.hidden,
    )


@router.get("/persons", response_model=PersonListOut)
def list_persons(
    include_hidden: bool = False,
    hidden_only: bool = False,
    album: int | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=120, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    viewer: str | None = Depends(optional_admin),
) -> PersonListOut:
    """A page of person clusters, named first then by face count descending.

    Hidden clusters are excluded unless ``include_hidden`` is set; ``hidden_only``
    returns only hidden ones (the Hidden view). ``album`` scopes membership and
    counts/covers to one album. ``q`` filters by name (or ``person <id>`` / id).
    ``limit``/``offset`` paginate so the UI loads people in pages like All Photos
    rather than fetching every cluster at once.

    Ordering and slicing happen in SQL so pages are stable across requests; the
    per-page cover/count lookups then run only for the ids on the page.
    """
    # Seeing hidden people is a gated capability: block the request (not just the
    # UI) when it is admin-only and the caller is not a signed-in admin.
    if (include_hidden or hidden_only) and requires_admin("person.show_hidden") and viewer is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conds = []
    if hidden_only:
        conds.append(Person.hidden.is_(True))
    elif not include_hidden:
        conds.append(Person.hidden.is_(False))
    if album is not None:
        conds.append(
            Person.id.in_(
                select(FacePerson.person_id)
                .join(Face, Face.id == FacePerson.face_id)
                .join(PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id)
                .where(PhotoAlbum.album_id == album)
            )
        )
    if q and q.strip():
        like = f"%{q.strip()}%"
        # Named people match on name; unnamed ones match on id or "person <id>"
        # (mirrors the old client-side filter).
        conds.append(
            or_(
                Person.name.ilike(like),
                and_(
                    Person.name.is_(None),
                    or_(
                        cast(Person.id, String).ilike(like),
                        ("person " + cast(Person.id, String)).ilike(like),
                    ),
                ),
            )
        )

    total = session.execute(
        select(func.count()).select_from(Person).where(*conds)
    ).scalar_one()
    if total == 0:
        return PersonListOut(total=0, items=[])

    # Face count per person (album-scoped), one grouped subquery we both order by
    # and read the count from — avoids a second pass.
    cnt_sub = select(
        FacePerson.person_id.label("pid"),
        func.count(func.distinct(FacePerson.face_id)).label("cnt"),
    )
    if album is not None:
        cnt_sub = cnt_sub.join(Face, Face.id == FacePerson.face_id).join(
            PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
        ).where(PhotoAlbum.album_id == album)
    cnt_sub = cnt_sub.group_by(FacePerson.person_id).subquery()
    cnt_col = func.coalesce(cnt_sub.c.cnt, 0)

    # Named first (NULL name sorts last), then biggest clusters, then id for a
    # stable tiebreak across pages.
    rows = session.execute(
        select(Person, cnt_col.label("cnt"))
        .outerjoin(cnt_sub, cnt_sub.c.pid == Person.id)
        .where(*conds)
        .order_by(Person.name.is_(None), cnt_col.desc(), Person.id)
        .limit(limit)
        .offset(offset)
    ).all()
    persons = [r[0] for r in rows]
    counts = {r[0].id: r[1] for r in rows}
    ids = [p.id for p in persons]

    # First member photo per page person (album-scoped), one DISTINCT ON query —
    # the fallback cover when no cover face is set (or it falls outside album).
    fm_stmt = (
        select(FacePerson.person_id, Face.photo_id)
        .join(Face, Face.id == FacePerson.face_id)
        .where(FacePerson.person_id.in_(ids))
    )
    if album is not None:
        fm_stmt = fm_stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
        ).where(PhotoAlbum.album_id == album)
    first_member = dict(
        session.execute(
            fm_stmt.order_by(FacePerson.person_id, Face.id).distinct(
                FacePerson.person_id
            )
        ).all()
    )

    # Photo of each explicit cover face (album-scoped so an out-of-album cover
    # falls back to a member), one query.
    cover_face_ids = [
        p.cover_face_id for p in persons if p.cover_face_id is not None
    ]
    cover_photo_of_face: dict[int, int] = {}
    if cover_face_ids:
        cf_stmt = select(Face.id, Face.photo_id).where(
            Face.id.in_(cover_face_ids)
        )
        if album is not None:
            cf_stmt = cf_stmt.join(
                PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
            ).where(PhotoAlbum.album_id == album)
        cover_photo_of_face = dict(session.execute(cf_stmt).all())

    items = [
        PersonOut(
            id=p.id,
            name=p.name,
            cover_face_id=p.cover_face_id,
            cover_photo_id=(
                cover_photo_of_face.get(p.cover_face_id)
                if p.cover_face_id is not None
                else None
            )
            or first_member.get(p.id),
            face_count=counts.get(p.id, 0),
            hidden=p.hidden,
        )
        for p in persons
    ]
    return PersonListOut(total=total, items=items)


def _set_hidden(session: Session, person_id: int, hidden: bool) -> PersonOut:
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")
    person.hidden = hidden
    person.locked = True  # A hide/unhide is a user decision; preserve it.
    session.commit()
    session.refresh(person)
    return _person_out(session, person)


@router.post("/persons/{person_id}/hide", response_model=PersonOut)
def hide_person(
    person_id: int,
    session: Session = Depends(get_session),
    _: str = Depends(gate("person.hide")),
) -> PersonOut:
    """Soft-hide a person cluster (e.g. a bad classification)."""
    return _set_hidden(session, person_id, True)


@router.post("/persons/{person_id}/unhide", response_model=PersonOut)
def unhide_person(
    person_id: int,
    session: Session = Depends(get_session),
    _: str = Depends(gate("person.hide")),
) -> PersonOut:
    """Restore a previously hidden person cluster."""
    return _set_hidden(session, person_id, False)


@router.get("/persons/{person_id}", response_model=PersonOut)
def get_person(
    person_id: int,
    album: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> PersonOut:
    """Return a single person cluster, or 404 if it does not exist.

    ``album`` scopes the face/photo counts and cover to one album when set.
    """
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")
    return _person_out(session, person, album)


@router.get("/persons/{person_id}/photos", response_model=list[PhotoOut])
def list_person_photos(
    person_id: int,
    album: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[Photo]:
    """Distinct photos that have at least one face assigned to this person.

    When ``album`` is given, restricted to photos that are in the album.
    """
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    stmt = (
        select(Photo)
        .join(Face, Face.photo_id == Photo.id)
        .join(FacePerson, FacePerson.face_id == Face.id)
        .where(FacePerson.person_id == person_id)
    )
    if album is not None:
        stmt = stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == Photo.id
        ).where(PhotoAlbum.album_id == album)
    photos = (
        session.execute(stmt.distinct().order_by(Photo.id)).scalars().all()
    )
    return list(photos)


@router.get("/persons/{person_id}/faces", response_model=list[FaceOut])
def list_person_faces(
    person_id: int,
    album: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    session: Session = Depends(get_session),
) -> list[FaceOut]:
    """The person's best member faces, highest ``det_score`` first.

    Used by the UI to offer alternative cover faces. Capped at ``limit`` (50 by
    default) so a person with hundreds of detections shows only the best ones
    rather than an unwieldy wall of faces. When ``album`` is given, only faces
    whose photo is in the album are considered.
    """
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    stmt = (
        select(Face)
        .join(FacePerson, FacePerson.face_id == Face.id)
        .where(FacePerson.person_id == person_id)
    )
    if album is not None:
        stmt = stmt.join(
            PhotoAlbum, PhotoAlbum.photo_id == Face.photo_id
        ).where(PhotoAlbum.album_id == album)
    faces = (
        session.execute(
            stmt.order_by(Face.det_score.desc(), Face.id).limit(limit)
        )
        .scalars()
        .all()
    )
    return [
        FaceOut(
            id=f.id,
            photo_id=f.photo_id,
            det_score=f.det_score,
            thumb_path=f.thumb_path,
            is_cover=(f.id == person.cover_face_id),
        )
        for f in faces
    ]


@router.post("/persons/{person_id}/cover", response_model=PersonOut)
def set_person_cover(
    person_id: int,
    body: SetCoverRequest,
    session: Session = Depends(get_session),
    _: str = Depends(gate("person.cover")),
) -> PersonOut:
    """Set the person's cover face to one of its member faces."""
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    link = session.get(FacePerson, body.face_id)
    if link is None or link.person_id != person_id:
        raise HTTPException(
            status_code=400, detail="face does not belong to this person"
        )

    person.cover_face_id = body.face_id
    person.locked = True
    session.commit()
    session.refresh(person)
    return _person_out(session, person)


@router.patch("/persons/{person_id}", response_model=PersonOut)
def rename_person(
    person_id: int,
    body: RenameRequest,
    session: Session = Depends(get_session),
    _: str = Depends(gate("person.rename")),
) -> PersonOut:
    """Set a person's name."""
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    person.name = body.name
    person.locked = True
    session.commit()
    session.refresh(person)
    return _person_out(session, person)


@router.post("/persons/merge", response_model=PersonOut)
def merge_persons(
    body: MergeRequest,
    session: Session = Depends(get_session),
    _: str = Depends(gate("person.merge")),
) -> PersonOut:
    """Merge all person clusters in ``ids`` into the first id."""
    if len(body.ids) < 2:
        raise HTTPException(status_code=400, detail="need at least 2 ids to merge")

    persons = {
        p.id: p
        for p in session.execute(
            select(Person).where(Person.id.in_(body.ids))
        ).scalars()
    }
    missing = [i for i in body.ids if i not in persons]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"unknown person id(s): {missing}"
        )

    target_id = body.ids[0]
    target = persons[target_id]
    other_ids = [i for i in body.ids[1:] if i != target_id]

    # A merge is a user decision; lock the result so a rescan won't undo it.
    target.locked = True

    # Reassign faces from the other persons onto the target.
    for other_id in other_ids:
        session.execute(
            FacePerson.__table__.update()
            .where(FacePerson.person_id == other_id)
            .values(person_id=target_id)
        )

    # Adopt the first non-null name among the merged persons if target has none.
    if target.name is None:
        for other_id in other_ids:
            if persons[other_id].name is not None:
                target.name = persons[other_id].name
                break

    for other_id in other_ids:
        session.delete(persons[other_id])

    session.commit()
    session.refresh(target)
    return _person_out(session, target)


@router.post("/faces/move")
def move_faces(
    body: MoveFacesRequest,
    session: Session = Depends(get_session),
    _: str = Depends(gate("face.move")),
) -> dict[str, object]:
    """Reassign faces to an existing person, or to a freshly created one."""
    if body.person_id is not None:
        target = session.get(Person, body.person_id)
        if target is None:
            raise HTTPException(status_code=404, detail="person not found")
    else:
        target = Person()
        session.add(target)
        session.flush()

    # Moving faces is a user decision; lock the target so a rescan preserves it.
    target.locked = True

    # Persons that might become empty after moving faces away from them.
    source_ids = {
        row
        for row in session.execute(
            select(FacePerson.person_id)
            .where(FacePerson.face_id.in_(body.face_ids))
            .where(FacePerson.person_id != target.id)
        ).scalars()
    }

    moved = 0
    for face_id in body.face_ids:
        link = session.get(FacePerson, face_id)
        if link is None:
            # A face must exist to be moved; skip unknown/undetected faces.
            if session.get(Face, face_id) is None:
                continue
            session.add(FacePerson(face_id=face_id, person_id=target.id))
        else:
            link.person_id = target.id
        moved += 1

    session.flush()

    # Clean up now-empty persons, but keep (and report) named empties.
    emptied_named: list[int] = []
    for source_id in source_ids:
        if _face_count(session, source_id) > 0:
            continue
        source = session.get(Person, source_id)
        if source is None:
            continue
        if source.name is None:
            session.delete(source)
        else:
            emptied_named.append(source_id)

    session.commit()
    return {
        "moved": moved,
        "person_id": target.id,
        "emptied_named_persons": emptied_named,
    }
