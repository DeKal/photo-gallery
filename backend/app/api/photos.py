"""Photos API: a flat, paginated listing of the whole library (All Photos).

A pure DB read — lives on the slim ``api`` service alongside persons/sim.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Photo
from app.schemas import PhotoListOut

router = APIRouter()

MAX_LIMIT = 500


@router.get("/photos", response_model=PhotoListOut)
def list_photos(
    limit: int = Query(default=100, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    order: str = Query(default="newest", pattern="^(newest|oldest)$"),
    session: Session = Depends(get_session),
) -> PhotoListOut:
    """A page of successfully-indexed photos plus the total count.

    Ordered by capture time (``taken_at``, falling back to ``scanned_at``);
    ``newest`` first by default. Photos that failed to process (``error`` set)
    are excluded.
    """
    ok = Photo.error.is_(None)
    total = session.execute(
        select(func.count()).select_from(Photo).where(ok)
    ).scalar_one()

    sort_key = func.coalesce(Photo.taken_at, Photo.scanned_at)
    ordering = (
        (sort_key.asc().nulls_last(), Photo.id.asc())
        if order == "oldest"
        else (sort_key.desc().nulls_last(), Photo.id.desc())
    )

    items = (
        session.execute(
            select(Photo).where(ok).order_by(*ordering).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    return PhotoListOut(total=total, items=list(items))
