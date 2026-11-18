"""Media API: serve photo thumbnails and original image files."""

from __future__ import annotations

import mimetypes
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Face, Photo

router = APIRouter()

# Thumbnails are content-addressed and never change for a given id, so allow the
# browser and any CDN (e.g. Vercel's edge) to cache them for a year. This turns
# a People/Similar page's burst of image requests into cache hits instead of
# repeated function invocations.
_CACHE = {"Cache-Control": "public, max-age=31536000, immutable"}


@router.get("/thumb/{photo_id}")
def get_thumb(
    photo_id: int, session: Session = Depends(get_session)
) -> Response:
    """Serve a photo's thumbnail JPEG from the DB, or the local file, else 404.

    The thumbnail bytes are preferred (works with no shared filesystem, e.g.
    serverless); ``thumb_path`` is the local-dev fallback.
    """
    photo = session.get(Photo, photo_id)
    data = photo.thumb_data if photo is not None else None
    thumb_path = photo.thumb_path if photo is not None else None
    # Return the pooled DB connection *before* streaming the file. FastAPI
    # otherwise holds the dependency's session open until the whole response is
    # sent, so a burst of image requests would pin every pooled connection for
    # the full transfer and exhaust the pool (QueuePool TimeoutError -> 500).
    session.close()
    if data is not None:
        return Response(content=bytes(data), media_type="image/jpeg", headers=_CACHE)
    if thumb_path and os.path.isfile(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg", headers=_CACHE)
    raise HTTPException(status_code=404, detail="thumbnail not found")


@router.get("/face-thumb/{face_id}")
def get_face_thumb(
    face_id: int, session: Session = Depends(get_session)
) -> Response:
    """Serve a face's cropped thumbnail JPEG from the DB, or the local file."""
    face = session.get(Face, face_id)
    data = face.thumb_data if face is not None else None
    thumb_path = face.thumb_path if face is not None else None
    session.close()  # Release the pooled connection before streaming (see above).
    if data is not None:
        return Response(content=bytes(data), media_type="image/jpeg", headers=_CACHE)
    if thumb_path and os.path.isfile(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg", headers=_CACHE)
    raise HTTPException(status_code=404, detail="face thumbnail not found")


@router.get("/image/{photo_id}")
def get_image(
    photo_id: int, session: Session = Depends(get_session)
) -> FileResponse:
    """Serve a photo's original file, or 404 if it is unavailable."""
    photo = session.get(Photo, photo_id)
    path = photo.path if photo is not None else None
    session.close()  # Release the pooled connection before streaming (see above).
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="image not found")
    media_type = mimetypes.guess_type(path)[0] or "image/jpeg"
    return FileResponse(path, media_type=media_type)
