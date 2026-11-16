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
    size: int = 256,
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
    img.thumbnail((size, size))
    img.save(thumb_path, format="JPEG")
    return thumb_path
