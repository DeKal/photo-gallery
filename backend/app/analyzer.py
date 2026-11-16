"""Model inference: CLIP image embeddings and InsightFace face embeddings.

Two local models power the clustering pipeline:

- **CLIP** (``open_clip`` ViT-B/32, ``laion2b_s34b_b79k``) produces a 512-d,
  L2-normalized embedding per image for visual-similarity clustering.
- **InsightFace** (``buffalo_l``) detects faces and produces a 512-d ArcFace
  embedding per face for person clustering.

Models are loaded lazily as module-level singletons on first use, so importing
this module stays cheap. Heavy third-party imports (``torch``, ``open_clip``,
``insightface``) are guarded inside the lazy getters. On Apple Silicon CLIP runs
on the MPS device; InsightFace runs on the ONNX CPU execution provider.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

_CLIP_BATCH_SIZE = 32
_EMBED_DIM = 512

# Lazily initialized singletons.
_clip: tuple[Any, Any, str] | None = None  # (model, preprocess, device)
_face_app: Any | None = None


def _device() -> str:
    """Return the best available torch device string (``mps`` or ``cpu``)."""
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _get_clip() -> tuple[Any, Any, str]:
    """Build and cache the CLIP model, its preprocessing transform, and device."""
    global _clip
    if _clip is None:
        import open_clip
        import torch  # noqa: F401 - ensures torch is importable before model use

        device = _device()
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        model.eval().to(device)
        _clip = (model, preprocess, device)
    return _clip


def _get_face_app() -> Any:
    """Build and cache the InsightFace ``buffalo_l`` analysis pipeline."""
    global _face_app
    if _face_app is None:
        import insightface

        app = insightface.app.FaceAnalysis(
            name="buffalo_l", providers=["CPUExecutionProvider"]
        )
        app.prepare(ctx_id=0, det_size=(640, 640))
        _face_app = app
    return _face_app


def embed_images(images: list[Image.Image]) -> np.ndarray:
    """Embed PIL images with CLIP.

    Returns an ``(N, 512)`` float32 array whose rows are L2-normalized, suitable
    for cosine-similarity clustering. Images are processed in batches of 32.
    Empty input yields a ``(0, 512)`` array.
    """
    if not images:
        return np.zeros((0, _EMBED_DIM), dtype=np.float32)

    import torch

    model, preprocess, device = _get_clip()
    chunks: list[np.ndarray] = []
    for start in range(0, len(images), _CLIP_BATCH_SIZE):
        batch_imgs = images[start : start + _CLIP_BATCH_SIZE]
        batch = torch.stack([preprocess(img) for img in batch_imgs]).to(device)
        with torch.no_grad():
            feats = model.encode_image(batch)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        chunks.append(feats.cpu().numpy().astype(np.float32))
    return np.concatenate(chunks, axis=0)


def detect_faces(image: Image.Image) -> list[dict]:
    """Detect and embed faces in a PIL image with InsightFace.

    Returns one dict per detected face::

        {"bbox": [x1, y1, x2, y2], "det_score": float, "vec": np.ndarray(512,)}

    ``vec`` is a 512-d float32 L2-normalized ArcFace embedding. Returns an empty
    list when no faces are detected.
    """
    app = _get_face_app()
    rgb = np.asarray(image.convert("RGB"))
    bgr = rgb[:, :, ::-1]  # InsightFace expects BGR input.
    faces = app.get(bgr)

    results: list[dict] = []
    for face in faces:
        vec = getattr(face, "normed_embedding", None)
        if vec is None:
            emb = np.asarray(face.embedding, dtype=np.float32)
            norm = np.linalg.norm(emb)
            vec = emb / norm if norm > 0 else emb
        vec = np.asarray(vec, dtype=np.float32)
        results.append(
            {
                "bbox": [float(x) for x in face.bbox],
                "det_score": float(face.det_score),
                "vec": vec,
            }
        )
    return results
