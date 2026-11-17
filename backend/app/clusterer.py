"""Clustering of face and image embeddings, persisted to Postgres.

Two entry points run on demand (see ``POST /cluster``):

- :func:`cluster_faces` groups ArcFace face vectors into *persons* with DBSCAN.
  It filters out weak/tiny detections first (they pollute clusters), then runs
  DBSCAN tuned for ArcFace cosine distance. It preserves user-named persons
  across re-runs by matching new cluster centroids to the centroids of existing
  named persons (cosine similarity).
- :func:`cluster_images` groups CLIP image vectors into visual *sim_clusters*
  with HDBSCAN. These carry no user state, so they are wiped and rebuilt each
  run.

Clustering metric: the ArcFace / CLIP vectors are L2-normalized, so cosine is the
natural distance. For faces, ``DBSCAN(metric="cosine")`` groups vectors whose
pairwise cosine distance is within ``FACE_EPS``; ArcFace embeddings of the same
person typically sit below ~0.4 cosine distance, well separated from different
people. For images, the installed ``hdbscan`` only accepts ``metric="cosine"``
via its ``algorithm="generic"`` path on float64 input, so :func:`_hdbscan_labels`
tries that first and, if the build rejects it, falls back to Euclidean on
L2-normalized vectors. On the unit sphere Euclidean distance is a monotonic
function of cosine distance (``d_euc^2 = 2 - 2*cos``), so the clustering is
equivalent.
"""

from __future__ import annotations

import logging

import numpy as np
from sqlalchemy.orm import Session

from app.models import (
    Face,
    FacePerson,
    ImageEmbedding,
    Person,
    PhotoSimCluster,
    SimCluster,
)

logger = logging.getLogger(__name__)

MIN_CLUSTER_SIZE = 3
MIN_SAMPLES = 1
# Cosine similarity threshold for reusing an existing named person's identity.
NAME_MATCH_THRESHOLD = 0.5

# --- Face clustering (DBSCAN) tuning --------------------------------------
# Max cosine distance between two faces of the *same* person. ArcFace normed
# embeddings put same-person pairs well under ~0.4; 0.38 keeps distinct people
# apart while absorbing pose/lighting variation of one person. If a single
# cluster ends up with a clearly-too-large share, drop to 0.34.
FACE_EPS = 0.38
FACE_MIN_SAMPLES = 3
# Detections weaker/smaller than these pollute clusters, so they are excluded
# from clustering (and left unassigned to any person).
MIN_DET_SCORE = 0.5
MIN_BBOX_SIDE = 40.0


def _l2_normalize(vecs: np.ndarray) -> np.ndarray:
    """Return ``vecs`` with each row scaled to unit L2 norm (zero rows untouched)."""
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vecs / norms


def _dbscan_labels(vecs: np.ndarray) -> np.ndarray:
    """Cluster ``(N, D)`` face vectors with DBSCAN, returning an ``(N,)`` label array.

    Pure function over the vectors (no DB), so it can be unit-tested on synthetic
    data. Uses cosine distance tuned for ArcFace embeddings; label ``-1`` marks
    noise (unassigned). An empty input yields an empty ``int`` array.
    """
    from sklearn.cluster import DBSCAN

    if len(vecs) == 0:
        return np.empty((0,), dtype=int)
    clusterer = DBSCAN(
        eps=FACE_EPS, min_samples=FACE_MIN_SAMPLES, metric="cosine"
    )
    return clusterer.fit_predict(vecs.astype(np.float64))


def _is_strong_face(face: Face) -> bool:
    """True if ``face`` is confident and large enough to cluster on.

    Filters out low-confidence detections (``det_score < MIN_DET_SCORE``) and
    tiny boxes (shorter bbox side ``< MIN_BBOX_SIDE`` px), which otherwise
    pollute clusters. Malformed bboxes are treated as weak.
    """
    if face.det_score is None or face.det_score < MIN_DET_SCORE:
        return False
    bbox = face.bbox
    if bbox is None or len(bbox) < 4:
        return False
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    if min(abs(x2 - x1), abs(y2 - y1)) < MIN_BBOX_SIDE:
        return False
    return True


def _hdbscan_labels(vecs: np.ndarray) -> np.ndarray:
    """Cluster ``(N, D)`` vectors with HDBSCAN, returning an ``(N,)`` label array.

    Pure function over the vectors (no DB), so it can be unit-tested on synthetic
    data. Prefers the cosine metric; falls back to Euclidean on L2-normalized
    vectors if the installed hdbscan build rejects cosine.
    """
    import hdbscan

    normalized = _l2_normalize(vecs.astype(np.float64))
    try:
        clusterer = hdbscan.HDBSCAN(
            metric="cosine",
            min_cluster_size=MIN_CLUSTER_SIZE,
            min_samples=MIN_SAMPLES,
            algorithm="generic",
        )
        return clusterer.fit_predict(normalized)
    except (ValueError, TypeError) as exc:
        logger.warning(
            "hdbscan cosine unavailable (%s); falling back to L2 on normalized vecs",
            exc,
        )
        clusterer = hdbscan.HDBSCAN(
            metric="euclidean",
            min_cluster_size=MIN_CLUSTER_SIZE,
            min_samples=MIN_SAMPLES,
        )
        return clusterer.fit_predict(normalized)


def _load_faces(session: Session) -> tuple[list[Face], np.ndarray]:
    """Load all faces with their vectors stacked into an ``(N, 512)`` float32 array."""
    faces = session.query(Face).order_by(Face.id).all()
    if not faces:
        return [], np.empty((0, 512), dtype=np.float32)
    vecs = np.asarray([np.asarray(f.vec, dtype=np.float32) for f in faces])
    return faces, vecs


def _load_image_embeddings(
    session: Session,
) -> tuple[list[ImageEmbedding], np.ndarray]:
    """Load all image embeddings stacked into an ``(N, 512)`` float32 array."""
    embeddings = (
        session.query(ImageEmbedding).order_by(ImageEmbedding.photo_id).all()
    )
    if not embeddings:
        return [], np.empty((0, 512), dtype=np.float32)
    vecs = np.asarray([np.asarray(e.vec, dtype=np.float32) for e in embeddings])
    return embeddings, vecs


def _centroid(vecs: np.ndarray) -> np.ndarray:
    """Mean of ``vecs`` renormalized to unit length (the cluster's direction)."""
    mean = vecs.mean(axis=0)
    norm = np.linalg.norm(mean)
    if norm == 0:
        return mean
    return mean / norm


def cluster_faces(session: Session) -> dict:
    """Cluster face vectors into persons; preserve named persons across runs.

    Weak detections (low ``det_score`` or tiny bbox) are excluded from the
    clustering step and left unassigned, so they do not pollute clusters.

    Returns ``{"faces": N, "clustered": C, "persons": K, "noise": M}`` where
    ``N`` is all faces, ``C`` the strong faces fed to DBSCAN, ``K`` the number
    of person clusters and ``M`` the unassigned faces (weak + DBSCAN noise).
    """
    all_faces, _ = _load_faces(session)
    n = len(all_faces)

    # Keep only confident, reasonably-sized faces for clustering.
    strong_faces = [f for f in all_faces if _is_strong_face(f)]
    filtered_out = n - len(strong_faces)

    # Not enough points for a cluster: everything is unassigned (noise).
    if len(strong_faces) < FACE_MIN_SAMPLES:
        session.query(FacePerson).delete()
        _drop_orphan_auto_persons(session)
        session.commit()
        return {"faces": n, "clustered": len(strong_faces), "persons": 0, "noise": n}

    vecs = np.asarray(
        [np.asarray(f.vec, dtype=np.float32) for f in strong_faces]
    )
    labels = _dbscan_labels(vecs)

    # Snapshot existing named-person centroids before we touch assignments, so we
    # can reuse their identity (and name) for matching new clusters.
    named_centroids = _named_person_centroids(session)

    # Rebuild all face->person assignments from scratch.
    session.query(FacePerson).delete()
    session.flush()

    dbscan_noise = int(np.sum(labels == -1))
    cluster_labels = sorted(int(x) for x in set(labels) if x != -1)
    reused_person_ids: set[int] = set()

    for label in cluster_labels:
        member_idx = np.where(labels == label)[0]
        member_faces = [strong_faces[i] for i in member_idx]
        centroid = _centroid(vecs[member_idx])

        person = _match_named_person(
            centroid, named_centroids, reused_person_ids
        )
        if person is None:
            person = Person(name=None)
            session.add(person)
            session.flush()
        else:
            reused_person_ids.add(person.id)

        # Cover face = highest detection score (best, most frontal) in cluster.
        cover = max(member_faces, key=lambda f: f.det_score)
        person.cover_face_id = cover.id

        for face in member_faces:
            session.add(FacePerson(face_id=face.id, person_id=person.id))

    session.flush()
    _drop_orphan_auto_persons(session)
    session.commit()

    noise = filtered_out + dbscan_noise
    return {
        "faces": n,
        "clustered": len(strong_faces),
        "persons": len(cluster_labels),
        "noise": noise,
    }


def _named_person_centroids(session: Session) -> list[tuple[Person, np.ndarray]]:
    """Centroid of each currently-named person, from its assigned face vecs."""
    result: list[tuple[Person, np.ndarray]] = []
    named = session.query(Person).filter(Person.name.isnot(None)).all()
    for person in named:
        rows = (
            session.query(Face.vec)
            .join(FacePerson, FacePerson.face_id == Face.id)
            .filter(FacePerson.person_id == person.id)
            .all()
        )
        if not rows:
            continue
        vecs = np.asarray([np.asarray(r[0], dtype=np.float32) for r in rows])
        result.append((person, _centroid(vecs)))
    return result


def _match_named_person(
    centroid: np.ndarray,
    named_centroids: list[tuple[Person, np.ndarray]],
    already_used: set[int],
) -> Person | None:
    """Return the best named person whose centroid is >= threshold, else None.

    Each named person can only be claimed by one new cluster per run.
    """
    best: Person | None = None
    best_sim = NAME_MATCH_THRESHOLD
    for person, other in named_centroids:
        if person.id in already_used:
            continue
        sim = float(np.dot(centroid, other))
        if sim >= best_sim:
            best_sim = sim
            best = person
    return best


def _drop_orphan_auto_persons(session: Session) -> None:
    """Delete unnamed persons with no remaining faces. Never deletes named ones."""
    auto_persons = session.query(Person).filter(Person.name.is_(None)).all()
    for person in auto_persons:
        has_faces = (
            session.query(FacePerson)
            .filter(FacePerson.person_id == person.id)
            .first()
        )
        if has_faces is None:
            person.cover_face_id = None
            session.delete(person)


def cluster_images(session: Session) -> dict:
    """Cluster image vectors into sim_clusters; wipe and rebuild each run.

    Returns ``{"photos": N, "clusters": K, "noise": M}``.
    """
    embeddings, vecs = _load_image_embeddings(session)
    n = len(embeddings)

    # Always start from a clean slate for similarity clusters.
    session.query(PhotoSimCluster).delete()
    session.query(SimCluster).delete()
    session.flush()

    if n < MIN_CLUSTER_SIZE:
        session.commit()
        return {"photos": n, "clusters": 0, "noise": n}

    labels = _hdbscan_labels(vecs)
    noise = int(np.sum(labels == -1))
    cluster_labels = sorted(int(x) for x in set(labels) if x != -1)

    for index, label in enumerate(cluster_labels):
        sim_cluster = SimCluster(label=str(index))
        session.add(sim_cluster)
        session.flush()
        member_idx = np.where(labels == label)[0]
        for i in member_idx:
            session.add(
                PhotoSimCluster(
                    photo_id=embeddings[i].photo_id,
                    sim_cluster_id=sim_cluster.id,
                )
            )

    session.commit()
    return {"photos": n, "clusters": len(cluster_labels), "noise": noise}
