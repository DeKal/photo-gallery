"""Pydantic request/response models for the REST API."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ScanRequest(BaseModel):
    """Request body for ``POST /scan``."""

    root_path: str


class ScanStatus(BaseModel):
    """Progress snapshot of a scan, serialized from the ``Scan`` ORM row."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    root_path: str
    status: str
    done: int
    total: int
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class PersonOut(BaseModel):
    """A person cluster with cover face/photo and member count."""

    id: int
    name: Optional[str] = None
    cover_face_id: Optional[int] = None
    cover_photo_id: Optional[int] = None
    face_count: int
    hidden: bool = False


class PhotoOut(BaseModel):
    """A photo in listings (e.g. the photos belonging to a person)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    path: str
    thumb_path: Optional[str] = None


class SimClusterOut(BaseModel):
    """A visual-similarity cluster with a cover photo and member count."""

    id: int
    label: Optional[str] = None
    cover_photo_id: Optional[int] = None
    photo_count: int


class SimilarPhoto(BaseModel):
    """A photo near a query photo, by cosine distance (smaller = closer)."""

    photo_id: int
    distance: float
    thumb_path: Optional[str] = None


class RenameRequest(BaseModel):
    """Request body for ``PATCH /persons/{id}``."""

    name: str


class FaceOut(BaseModel):
    """A single detected face belonging to a person."""

    id: int
    photo_id: int
    det_score: float
    thumb_path: Optional[str] = None
    is_cover: bool = False


class SetCoverRequest(BaseModel):
    """Request body for ``POST /persons/{id}/cover``."""

    face_id: int


class MergeRequest(BaseModel):
    """Request body for ``POST /persons/merge``."""

    ids: list[int]


class MoveFacesRequest(BaseModel):
    """Request body for ``POST /faces/move``.

    ``person_id`` is ``None`` to create a new unnamed person for the faces.
    """

    face_ids: list[int]
    person_id: Optional[int] = None
