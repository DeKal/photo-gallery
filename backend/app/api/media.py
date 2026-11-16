"""Media API: serve photo thumbnails and original image files."""

from __future__ import annotations

import mimetypes
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Photo

router = APIRouter()


@router.get("/thumb/{photo_id}")
def get_thumb(
    photo_id: int, session: Session = Depends(get_session)
) -> FileResponse:
    """Serve a photo's thumbnail as JPEG, or 404 if it is unavailable."""
    photo = session.get(Photo, photo_id)
    if photo is None or not photo.thumb_path or not os.path.isfile(photo.thumb_path):
        raise HTTPException(status_code=404, detail="thumbnail not found")
    return FileResponse(photo.thumb_path, media_type="image/jpeg")


@router.get("/image/{photo_id}")
def get_image(
    photo_id: int, session: Session = Depends(get_session)
) -> FileResponse:
    """Serve a photo's original file, or 404 if it is unavailable."""
    photo = session.get(Photo, photo_id)
    if photo is None or not os.path.isfile(photo.path):
        raise HTTPException(status_code=404, detail="image not found")
    media_type = mimetypes.guess_type(photo.path)[0] or "image/jpeg"
    return FileResponse(photo.path, media_type=media_type)
