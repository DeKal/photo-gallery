"""Deterministically (re)generate the e2e fixture image set in ``fixtures/``.

Run this once to materialize the images the end-to-end tests scan::

    cd backend && .venv/bin/python -m tests.make_fixtures

The set is designed so that the real CLIP + InsightFace + HDBSCAN pipeline
produces *real* clusters (not all-noise), which is what makes the e2e
meaningful:

Person cluster(s) -- FULL-IMAGE strategy
    We take one real multi-face group photo from InsightFace's bundled test
    data (``get_image('t1')``, 6 faces) and write **four slightly augmented
    copies** (``group_1.jpg`` .. ``group_4.jpg``). Each of the 6 people then
    recurs across all 4 photos, giving 6 groups of ~4 near-identical ArcFace
    vectors -> HDBSCAN (min_cluster_size=3) yields ~6 person clusters.

    Why not crop a single face into ``personA_1..4``? A tight single face
    *does* re-detect, but 4 near-duplicate points in isolation are too few/too
    uniform for HDBSCAN's stability test -- it labels all 4 as noise, so
    persons would be 0. The full-image copies give many faces across several
    clusters, which HDBSCAN separates reliably. This is the documented choice.

Similarity cluster -- near-duplicate scenes
    A deterministic color-gradient base plus three tiny variants (crop, slight
    brightness, JPEG re-encode) written as ``scene_1.jpg`` .. ``scene_4.jpg``.
    CLIP embeds these to near-identical vectors -> one visual sim-cluster, and
    each scene's nearest neighbor (``/photos/{id}/similar``) is another scene.

Noise
    Two unrelated flat/checkerboard images (``noise_1.jpg``, ``noise_2.jpg``).

Everything is deterministic: fixed source image and fixed transforms, no RNG.
"""

from __future__ import annotations

import io
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _load_t1() -> Image.Image:
    """Return InsightFace's bundled ``t1`` group photo as an RGB PIL image."""
    from insightface.data import get_image as get_builtin_image

    bgr = get_builtin_image("t1")  # (H, W, 3) BGR uint8
    rgb = bgr[:, :, ::-1]
    return Image.fromarray(np.ascontiguousarray(rgb))


def _group_variant(base: Image.Image, index: int) -> Image.Image:
    """Return a mildly augmented copy of the group photo (same faces)."""
    img = base.copy()
    if index == 1:
        # Horizontal + vertical black padding (bbox shift, same faces).
        img = ImageOps.expand(img, border=24, fill=(0, 0, 0))
    elif index == 2:
        # JPEG quality 70 round-trip (compression noise).
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        buf.seek(0)
        img = Image.open(buf).convert("RGB")
    elif index == 3:
        # Mild downscale.
        img = img.resize((int(img.width * 0.92), int(img.height * 0.92)))
    return img


def _gradient_scene(size: int = 320) -> Image.Image:
    """Deterministic RGB color-gradient base image."""
    xs = np.arange(size)
    ys = np.arange(size)[:, None]
    arr = np.empty((size, size, 3), dtype=np.uint8)
    arr[:, :, 0] = (xs % 256)[None, :]
    arr[:, :, 1] = ((xs * 2) % 256)[None, :]
    arr[:, :, 2] = ((ys + xs[None, :]) % 256)
    return Image.fromarray(arr)


def _scene_variant(base: Image.Image, index: int) -> Image.Image:
    """Return a near-duplicate of the scene (tiny crop / brightness / JPEG)."""
    img = base.copy()
    if index == 1:
        img = img.crop((8, 8, base.width - 8, base.height - 8)).resize(
            (base.width, base.height)
        )
    elif index == 2:
        img = ImageEnhance.Brightness(img).enhance(1.06)
    elif index == 3:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=72)
        buf.seek(0)
        img = Image.open(buf).convert("RGB")
    return img


def _noise_images() -> list[Image.Image]:
    """Two visually unrelated images to act as clustering noise."""
    teal = np.zeros((300, 300, 3), dtype=np.uint8)
    teal[:, :] = (16, 160, 160)
    checker = np.zeros((300, 300, 3), dtype=np.uint8)
    block = 30
    for y in range(0, 300, block):
        for x in range(0, 300, block):
            if ((x // block) + (y // block)) % 2 == 0:
                checker[y : y + block, x : x + block] = 255
    return [Image.fromarray(teal), Image.fromarray(checker)]


def build() -> list[Path]:
    """(Re)generate the fixture set, overwriting any existing images."""
    if FIXTURES_DIR.exists():
        shutil.rmtree(FIXTURES_DIR)
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []

    # Person cluster(s): 4 augmented copies of the 6-face group photo.
    base = _load_t1()
    for i in range(4):
        out = FIXTURES_DIR / f"group_{i + 1}.jpg"
        _group_variant(base, i).save(out, format="JPEG", quality=95)
        written.append(out)

    # Similarity cluster: 4 near-duplicate scenes.
    scene = _gradient_scene()
    for i in range(4):
        out = FIXTURES_DIR / f"scene_{i + 1}.jpg"
        _scene_variant(scene, i).save(out, format="JPEG", quality=95)
        written.append(out)

    # Noise.
    for i, img in enumerate(_noise_images(), start=1):
        out = FIXTURES_DIR / f"noise_{i}.jpg"
        img.save(out, format="JPEG", quality=95)
        written.append(out)

    return written


if __name__ == "__main__":
    paths = build()
    print(f"Wrote {len(paths)} fixtures to {FIXTURES_DIR}:")
    for p in sorted(paths):
        print(f"  {p.name}")
