"""Filesystem scanning helpers: walk a photo tree, hash files, build thumbnails.

Provides the low-level image I/O used by the scan pipeline:
- ``iter_images`` recursively finds supported image files in a directory.
- ``file_sha256`` computes a stable content hash used as the canonical photo id.
- ``load_image`` decodes a file to an RGB :class:`PIL.Image.Image`.
- ``make_thumbnail`` renders a cached JPEG thumbnail keyed by sha256.

HEIC/HEIF support is enabled at import time via ``pillow_heif`` when available.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from PIL import Image, UnidentifiedImageError

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover - degrades gracefully without the plugin
    pass

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}

_CHUNK_SIZE = 1024 * 1024  # 1 MiB


class UnreadableImageError(Exception):
    """Raised when an image file cannot be decoded."""


def iter_images(root: str | Path) -> Iterator[Path]:
    """Yield image files under ``root`` in deterministic (sorted) order.

    Recurses into subdirectories, skips hidden files and directories (names
    starting with ``.``), and only yields files whose lowercased suffix is in
    :data:`IMAGE_EXTS`.
    """
    root = Path(root)
    for entry in sorted(root.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            yield from iter_images(entry)
        elif entry.is_file() and entry.suffix.lower() in IMAGE_EXTS:
            yield entry


def file_sha256(path: str | Path) -> str:
    """Return the hex SHA-256 digest of a file, streamed in chunks."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


# EXIF tag ids for capture time (DateTimeOriginal, then DateTime).
_EXIF_DATETIME_TAGS = (36867, 306)


def file_taken_at(path: str | Path) -> datetime | None:
    """Best-effort capture time for an image, as a timezone-aware UTC datetime.

    Prefers the EXIF capture timestamp (``DateTimeOriginal``, then ``DateTime``,
    formatted ``YYYY:MM:DD HH:MM:SS``); when no usable EXIF date is present it
    falls back to the file's last-modified time. Returns ``None`` only if even
    the filesystem timestamp cannot be read.
    """
    try:
        with Image.open(path) as img:
            exif = img.getexif()
        for tag in _EXIF_DATETIME_TAGS:
            raw = exif.get(tag)
            if not raw:
                continue
            try:
                dt = datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S")
                return dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    except (UnidentifiedImageError, OSError, ValueError):
        pass  # Fall through to the filesystem mtime.

    try:
        mtime = Path(path).stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        return None


def load_image(path: str | Path) -> Image.Image:
    """Open ``path`` and return it as an RGB image.

    Raises :class:`UnreadableImageError` on any decode failure.
    """
    try:
        with Image.open(path) as img:
            return img.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise UnreadableImageError(str(path)) from e


def make_thumbnail(
    path: str | Path,
    out_dir: str | Path,
    size: int = 512,
    sha256: str | None = None,
) -> Path:
    """Render a cached ``<sha256>.jpg`` thumbnail for ``path`` into ``out_dir``.

    The thumbnail preserves aspect ratio with its largest dimension capped at
    ``size``. If the thumbnail already exists it is returned unchanged
    (idempotent cache). ``sha256`` is computed from the file if not supplied.
    """
    out_dir = Path(out_dir)
    if sha256 is None:
        sha256 = file_sha256(path)
    thumb_path = out_dir / f"{sha256}.jpg"
    if thumb_path.exists():
        return thumb_path

    out_dir.mkdir(parents=True, exist_ok=True)
    img = load_image(path)
    img.thumbnail((size, size), Image.LANCZOS)
    img.save(thumb_path, format="JPEG", quality=88)
    return thumb_path


def make_face_thumbnail(
    image: Image.Image,
    bbox: list[float],
    out_dir: str | Path,
    face_key: int | str,
    size: int = 256,
    margin: float = 0.45,
) -> Path:
    """Render a cropped, square face thumbnail into ``out_dir/faces``.

    Takes a *square* region from ``image`` centred on the face ``bbox``
    (``[x1, y1, x2, y2]``), sized to the larger box side expanded by ``margin``
    on each side, with a little extra headroom so hair/chin are not clipped.
    The square is shifted (not shrunk) to stay inside the image, so the crop is
    filled with real pixels rather than black padding, then resized to ``size``.
    Saved as JPEG at ``faces/<face_key>.jpg`` and returned (overwriting any
    existing file so a re-crop refreshes the cache).
    """
    faces_dir = Path(out_dir) / "faces"
    faces_dir.mkdir(parents=True, exist_ok=True)

    img = image.convert("RGB")
    w, h = img.size
    x1, y1, x2, y2 = (float(v) for v in bbox)
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1

    bw = x2 - x1
    bh = y2 - y1
    cx = (x1 + x2) / 2.0
    # Bias the centre up a little for natural headroom above the face.
    cy = (y1 + y2) / 2.0 - bh * 0.1

    # Square side = larger box dimension plus margin on both sides, capped to
    # what the image can actually provide.
    side = max(bw, bh) * (1.0 + 2.0 * margin)
    side = min(side, float(w), float(h))
    if side < 1.0:
        side = 1.0

    half = side / 2.0
    left = cx - half
    top = cy - half
    # Shift the window so it stays fully inside the image (keeps it filled).
    left = max(0.0, min(left, w - side))
    top = max(0.0, min(top, h - side))

    il, it = int(round(left)), int(round(top))
    iside = int(round(side))
    crop = img.crop((il, it, min(w, il + iside), min(h, it + iside)))

    if crop.width > size or crop.height > size:
        crop = crop.resize((size, size), Image.LANCZOS)

    thumb_path = faces_dir / f"{face_key}.jpg"
    crop.save(thumb_path, format="JPEG", quality=88)
    return thumb_path


def image_sharpness(image: Image.Image) -> float:
    """Focus measure for ``image``: variance of the Laplacian over grayscale.

    Higher means sharper; out-of-focus or motion-blurred crops score low. Used
    at scan time to tag each face crop so clustering can drop blurry faces
    without re-decoding images. Computed on the stored crop (not the full
    photo) so a one-off backfill of existing faces matches new scans.
    """
    import cv2
    import numpy as np

    gray = np.asarray(image.convert("L"), dtype=np.float64)
    if gray.size == 0:
        return 0.0
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())
