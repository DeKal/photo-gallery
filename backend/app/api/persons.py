"""Persons API: list, rename, merge person clusters and move faces between them."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Face, FacePerson, Person, Photo
from app.schemas import (
    MergeRequest,
    MoveFacesRequest,
    PersonOut,
    PhotoOut,
    RenameRequest,
)

router = APIRouter()


def _face_count(session: Session, person_id: int) -> int:
    """Number of faces assigned to ``person_id``."""
    return (
        session.execute(
            select(func.count())
            .select_from(FacePerson)
            .where(FacePerson.person_id == person_id)
        ).scalar_one()
    )


def _cover_photo_id(session: Session, person: Person) -> int | None:
    """Photo of the cover face if set, else a photo of any member face."""
    if person.cover_face_id is not None:
        photo_id = session.execute(
            select(Face.photo_id).where(Face.id == person.cover_face_id)
        ).scalar_one_or_none()
        if photo_id is not None:
            return photo_id

    return session.execute(
        select(Face.photo_id)
        .join(FacePerson, FacePerson.face_id == Face.id)
        .where(FacePerson.person_id == person.id)
        .order_by(Face.id)
        .limit(1)
    ).scalar_one_or_none()


def _person_out(session: Session, person: Person) -> PersonOut:
    """Build a ``PersonOut`` for ``person`` (one count + one cover query each)."""
    return PersonOut(
        id=person.id,
        name=person.name,
        cover_face_id=person.cover_face_id,
        cover_photo_id=_cover_photo_id(session, person),
        face_count=_face_count(session, person.id),
    )


@router.get("/persons", response_model=list[PersonOut])
def list_persons(session: Session = Depends(get_session)) -> list[PersonOut]:
    """List all person clusters, ordered by face count descending."""
    persons = session.execute(select(Person)).scalars().all()
    out = [_person_out(session, p) for p in persons]
    out.sort(key=lambda p: p.face_count, reverse=True)
    return out


@router.get("/persons/{person_id}", response_model=PersonOut)
def get_person(
    person_id: int, session: Session = Depends(get_session)
) -> PersonOut:
    """Return a single person cluster, or 404 if it does not exist."""
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")
    return _person_out(session, person)


@router.get("/persons/{person_id}/photos", response_model=list[PhotoOut])
def list_person_photos(
    person_id: int, session: Session = Depends(get_session)
) -> list[Photo]:
    """Distinct photos that have at least one face assigned to this person."""
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    photos = (
        session.execute(
            select(Photo)
            .join(Face, Face.photo_id == Photo.id)
            .join(FacePerson, FacePerson.face_id == Face.id)
            .where(FacePerson.person_id == person_id)
            .distinct()
            .order_by(Photo.id)
        )
        .scalars()
        .all()
    )
    return list(photos)


@router.patch("/persons/{person_id}", response_model=PersonOut)
def rename_person(
    person_id: int,
    body: RenameRequest,
    session: Session = Depends(get_session),
) -> PersonOut:
    """Set a person's name."""
    person = session.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    person.name = body.name
    session.commit()
    session.refresh(person)
    return _person_out(session, person)


@router.post("/persons/merge", response_model=PersonOut)
def merge_persons(
    body: MergeRequest, session: Session = Depends(get_session)
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
    body: MoveFacesRequest, session: Session = Depends(get_session)
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
