"""Scan API: kick off a folder scan and poll its progress."""

from __future__ import annotations

import os
import subprocess
import sys

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.db import get_session
from app.drive import is_drive_url
from app.models import Scan
from app.pipeline import run_scan
from app.schemas import ScanRequest, ScanStatus

router = APIRouter()


@router.post("/scan")
def start_scan(
    body: ScanRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict[str, int]:
    """Create a scan for ``root_path`` and run the pipeline in the background.

    ``root_path`` is either a local directory or a public Google Drive folder
    URL; Drive folders are downloaded locally first by the pipeline. When
    ``album_name`` is given, every photo the scan touches is added to that
    album (created on demand).
    """
    root = body.root_path.strip()
    if not is_drive_url(root) and not os.path.isdir(root):
        raise HTTPException(
            status_code=400,
            detail="root_path is not a directory or a Google Drive folder URL",
        )

    album_id: int | None = None
    if body.album_name and body.album_name.strip():
        # Imported lazily: the slim API never scans, so the pipeline-side helper
        # lives with the albums router rather than being a scan dependency.
        from app.api.albums import get_or_create_album

        album_id = get_or_create_album(session, body.album_name).id

    scan = Scan(
        root_path=root, status="pending", done=0, total=0, album_id=album_id
    )
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


@router.get("/pick-folder")
def pick_folder(_: str = Depends(require_admin)) -> dict[str, str | None]:
    """Open a native folder picker on the host and return the chosen path.

    The backend runs natively on the user's machine, so it can pop the OS
    dialog directly. Returns ``{"path": null}`` if the user cancels. Only
    macOS (osascript) is supported; other platforms return 501.
    """
    if sys.platform != "darwin":
        raise HTTPException(
            status_code=501, detail="folder picker only supported on macOS"
        )
    script = (
        'POSIX path of (choose folder with prompt "Select your photos folder")'
    )
    try:
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=300,
        )
    except Exception as e:  # noqa: BLE001 - surface any launch failure as 500
        raise HTTPException(status_code=500, detail=str(e)) from e
    # User pressed Cancel -> osascript exits non-zero with "User canceled".
    if out.returncode != 0:
        if "User canceled" in out.stderr:
            return {"path": None}
        raise HTTPException(status_code=500, detail=out.stderr.strip() or "picker failed")
    return {"path": out.stdout.strip() or None}
