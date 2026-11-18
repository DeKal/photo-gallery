"""Google Drive folder ingest.

Download every image in a public ("anyone with the link") Google Drive folder
into a local staging directory and return a map from each downloaded file's
absolute local path to its Drive file id. The scan pipeline records both: the
local path (needed for ML analysis and as a serving fallback) and the Drive id
(so the UI can display the image straight from Drive).

Only public folders are supported — no OAuth or API key. Enumeration and
download both go through ``gdown``, whose folder listing yields the per-file
``id`` alongside the local path it will be written to, giving an exact
file-to-id mapping.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_DRIVE_HOST_RE = re.compile(r"https?://(?:drive|docs)\.google\.com/", re.IGNORECASE)
_FOLDER_ID_RE = re.compile(r"/folders/([A-Za-z0-9_-]+)")


def is_drive_url(value: str) -> bool:
    """True if ``value`` looks like a Google Drive URL (not a local path)."""
    return bool(_DRIVE_HOST_RE.match(value.strip()))


def folder_slug(url: str) -> str:
    """A stable, filesystem-safe directory name derived from a Drive folder URL.

    Uses the folder id when present so re-scanning the same folder reuses (and
    dedups into) the same staging directory; falls back to a sanitized URL.
    """
    match = _FOLDER_ID_RE.search(url)
    if match:
        return match.group(1)
    return re.sub(r"[^A-Za-z0-9_-]+", "_", url.strip())[:80] or "drive"


def download_drive_folder(url: str, dest: Path) -> dict[str, str]:
    """Download a public Drive folder into ``dest``; return ``{abs_local_path: file_id}``.

    First lists the folder (no download) to learn every file's id and target
    local path, then downloads each file by id. Downloads resume/skip files
    already present, so a re-run is cheap. Files that fail to download are
    logged and omitted from the returned map (the pipeline still indexes
    whatever landed on disk, just without a Drive id).
    """
    import gdown

    dest.mkdir(parents=True, exist_ok=True)
    listing = gdown.download_folder(
        url=url,
        output=str(dest),
        skip_download=True,
        quiet=True,
        use_cookies=False,
    )
    if not listing:
        return {}

    mapping: dict[str, str] = {}
    for entry in listing:
        local_path = Path(entry.local_path)
        try:
            gdown.download(
                id=entry.id,
                output=str(local_path),
                quiet=True,
                resume=True,
            )
        except Exception:  # noqa: BLE001 - one bad file must not abort the folder
            logger.exception("drive: failed to download %s (%s)", entry.path, entry.id)
            continue
        mapping[str(local_path.resolve())] = entry.id
    return mapping
