# Photo Clustering App — Design

**Date:** 2026-11-16
**Status:** Approved for implementation

## Purpose

A local web application to scan a folder of photos (2k–10k images) and group them
two ways: by person (face recognition) and by visual similarity (image embeddings).
Users browse clusters, name person groups, and merge/split them. All analysis runs
locally with open models — no external API (no ChatGPT) required.

## Constraints & Decisions

- **Scale:** 2,000–10,000 photos. Flat vector search is adequate.
- **Grouping:** Both faces *and* visual similarity, shown as separate views.
- **UI:** Local web app — FastAPI backend, React + Vite frontend.
- **Labeling:** Person clusters can be named and persisted; groups can be merged and split.
- **Hardware:** Apple Silicon. Backend runs natively on the host to use MPS acceleration.
- **Database:** PostgreSQL with the `pgvector` extension, run via docker-compose. It
  replaces both a relational store and a separate vector index.
- **Topology (hybrid):** Postgres runs in docker-compose; the backend and frontend run
  natively on the host. Docker on macOS cannot access Metal/MPS, so the compute-heavy
  backend stays on the host for speed.

## Architecture

```
Browser UI (React + Vite)
      | REST/JSON + static image serving
FastAPI backend (Python 3.11, host-native, MPS)
      |-- Scanner   : walk folder, sha256, thumbnail
      |-- Analyzer  : CLIP embed + InsightFace detect/embed
      |-- Clusterer : HDBSCAN on each embedding set
      |-- Store     : PostgreSQL + pgvector; thumbnails on disk
PostgreSQL + pgvector (docker-compose)
```

### Models (all local)

- **Faces:** InsightFace `buffalo_l` — detection + ArcFace 512-d embeddings.
- **Similarity:** `open_clip` ViT-B/32 — 512-d image embeddings. Runs on MPS.

### Clustering (unknown group count)

- Face embeddings → HDBSCAN (cosine, `min_cluster_size=3`) → candidate persons.
  Noise points (label -1) form an "unsorted" bucket.
- CLIP embeddings → HDBSCAN → visual-similarity groups. Tight clusters surface
  near-duplicates.
- Re-clustering preserves named persons by matching new cluster centroids to prior labels.

## Data Model (PostgreSQL + pgvector)

```
photos(id, path, sha256 UNIQUE, width, height, taken_at, thumb_path, error, scanned_at)
image_embeddings(photo_id FK, vec vector(512))
faces(id, photo_id FK, bbox, det_score, vec vector(512))
persons(id, name, cover_face_id)
face_person(face_id FK, person_id FK)
sim_clusters(id, label)
photo_sim_cluster(photo_id FK, sim_cluster_id FK)
scans(id, root_path, status, done, total, started_at, finished_at)
```

Indexes: `ivfflat` cosine on both `vec` columns.

## REST API

```
POST   /scan                 {root_path}           -> {scan_id}
GET    /scan/{id}                                   -> {status, done, total}
GET    /persons                                      -> person clusters + names
GET    /persons/{id}/photos
PATCH  /persons/{id}         {name}                 -> rename
POST   /persons/merge        {ids[]}                -> merge person clusters
POST   /faces/move           {face_ids[], person_id|null} -> split/reassign
GET    /sim-clusters                                 -> visual-similarity groups
GET    /photos/{id}/similar?k=50                     -> pgvector kNN
GET    /thumb/{photo_id}
GET    /image/{photo_id}
```

## Scan Pipeline (async background task)

1. Walk `root_path`, filter by image extension.
2. Per file: sha256 — skip if hash already present (idempotent, dedup, resumable).
3. Decode with Pillow (`pillow-heif` for HEIC); make a 256px thumbnail.
4. Batch CLIP embed on MPS (batch size 32).
5. InsightFace detect → per face: bbox, detection score, ArcFace vector.
6. Insert photo and vectors; update `scans` progress.
7. After scan (or on demand): run HDBSCAN for faces and images; persist clusters.

## Error Handling

- Corrupt/unreadable image: log, set `photos.error`, skip, continue the scan.
- Photo with no face: still indexed for the similarity view.
- Scan crash: `scans.status = failed`; resumable because hashing skips done files.
- MPS out-of-memory: reduce batch size, fall back to CPU.

## Testing

- Backend: pytest. Pipeline test on a tiny fixture image set; clustering tests on
  synthetic vectors; API contract tests.
- Frontend: minimal component smoke tests.

## Out of Scope (v1, YAGNI)

- No external/cloud models (ChatGPT etc.).
- No authentication / multi-user.
- No incremental file-system watching (manual re-scan only).
- No video support.
