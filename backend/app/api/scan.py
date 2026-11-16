"""Scan API: kick off a folder scan and poll its progress."""

from __future__ import annotations

import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Scan
from app.pipeline import run_scan
from app.schemas import ScanRequest, ScanStatus

router = APIRouter()


@router.post("/scan")
def start_scan(
    body: ScanRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
) -> dict[str, int]:
    """Create a scan for ``root_path`` and run the pipeline in the background."""
    if not os.path.isdir(body.root_path):
        raise HTTPException(status_code=400, detail="root_path is not a directory")

    scan = Scan(root_path=body.root_path, status="pending", done=0, total=0)
    session.add(scan)
    session.commit()
    session.refresh(scan)

    background_tasks.add_task(run_scan, scan.id)
    return {"scan_id": scan.id}


@router.get("/scan/{scan_id}", response_model=ScanStatus)
def get_scan(scan_id: int, session: Session = Depends(get_session)) -> Scan:
    """Return the progress snapshot for a scan, or 404 if it does not exist."""
    scan = session.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="scan not found")
    return scan
