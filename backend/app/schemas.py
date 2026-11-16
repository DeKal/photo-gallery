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
