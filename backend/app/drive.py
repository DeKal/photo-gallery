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
from typing import Callable

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


def download_drive_folder(
    url: str,
    dest: Path,
    on_listed: Callable[[int], None] | None = None,
) -> dict[str, str]:
    """Download a public Drive folder into ``dest``; return ``{abs_local_path: file_id}``.

    Lists the folder first (no download) to learn every file's id and target
    local path, then lets gdown download the whole folder **in one session**.
    Per-file ``uc?id=`` downloads fail for large files (Google's virus-scan
    confirmation page), whereas the folder-session download carries the cookies
    needed to pass it — so we download via the folder, then map each file that
    landed on disk back to its Drive id using the listing.

    ``on_listed(total)`` is called once the listing is known, so the caller can
    set up a progress total before the (blocking) download begins.
    """
    import gdown

    dest.mkdir(parents=True, exist_ok=True)
    logger.info("drive: listing folder %s", url)
    listing = gdown.download_folder(
        url=url,
        output=str(dest),
        skip_download=True,
        quiet=True,
        use_cookies=False,
    )
    if not listing:
        logger.warning("drive: listing returned no files for %s", url)
        if on_listed is not None:
            on_listed(0)
        return {}

    total = len(listing)
    logger.info("drive: listed %d file(s); downloading into %s", total, dest)
    if on_listed is not None:
        on_listed(total)

    # Folder-session download: handles the large-file confirmation page that
    # per-file downloads trip over. Resumes/skips files already on disk.
    gdown.download_folder(
        url=url,
        output=str(dest),
        quiet=True,
        use_cookies=False,
        resume=True,
    )

    mapping: dict[str, str] = {}
    missing = 0
    for entry in listing:
        local_path = Path(entry.local_path)
        if local_path.is_file():
            mapping[str(local_path.resolve())] = entry.id
        else:
            missing += 1
    logger.info(
        "drive: download complete — %d/%d file(s) on disk (%d missing)",
        len(mapping),
        total,
        missing,
    )
    return mapping
