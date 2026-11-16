# Photo Clustering App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local web app that scans a photo folder (2k–10k images) and groups images by person (face recognition) and by visual similarity, with a browsable UI that can name, merge, and split person clusters.

**Architecture:** FastAPI backend runs natively on the host (Apple Silicon, MPS). PostgreSQL + `pgvector` runs in docker-compose and stores metadata and 512-d embeddings. CLIP embeds whole images; InsightFace detects and embeds faces. HDBSCAN clusters each embedding set. A React + Vite frontend talks to the backend over REST.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2, psycopg, pgvector, open_clip, insightface, onnxruntime, hdbscan, Pillow + pillow-heif, pytest. Frontend: React, Vite, TypeScript. Postgres 16 + pgvector via Docker.

**Design doc:** `docs/plans/2026-11-16-photo-clustering-design.md`

**Execution note:** Each Task below is a self-contained unit sized for one subagent. Dispatch one subagent per Task, review, commit, then spawn the next. Tasks are ordered by dependency.

---

## Project Layout (target)

```
docker-compose.yml
backend/
  pyproject.toml
  app/
    __init__.py  main.py  config.py  db.py  models.py  schemas.py
    scanner.py  analyzer.py  clusterer.py
    api/  __init__.py  scan.py  persons.py  sim.py  media.py
  sql/ 001_init.sql
  tests/ conftest.py  fixtures/  test_*.py
frontend/
  package.json  vite.config.ts  index.html
  src/ main.tsx  App.tsx  api.ts  components/
```

---

## Task 1: Scaffold + Postgres/pgvector in docker-compose

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`
- Create: `backend/sql/001_init.sql` (extension only for now)
- Create: `.gitignore`, `backend/tests/__init__.py`, `backend/tests/test_health.py`

**Step 1 — docker-compose.yml:**
```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: photo
      POSTGRES_PASSWORD: photo
      POSTGRES_DB: photos
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backend/sql/001_init.sql:/docker-entrypoint-initdb.d/001_init.sql
volumes:
  pgdata:
```

**Step 2 — `backend/sql/001_init.sql`:** `CREATE EXTENSION IF NOT EXISTS vector;`

**Step 3 — `pyproject.toml`** deps: fastapi, uvicorn[standard], sqlalchemy>=2, psycopg[binary], pgvector, pydantic-settings, pillow, pillow-heif, numpy, open_clip_torch, torch, insightface, onnxruntime, hdbscan, scikit-learn, pytest, httpx.

**Step 4 — `config.py`:** `pydantic-settings` `Settings` with `database_url`, `data_dir` (`~/.photo-app`), `thumb_dir`.

**Step 5 — `main.py`:** FastAPI app, `GET /health -> {"status":"ok"}`.

**Step 6 — failing test** `tests/test_health.py` using `httpx`/`TestClient` asserts `/health` returns 200 `{"status":"ok"}`. Run `pytest -v` → fail, then implement, → pass.

**Step 7 — commit:** `feat: scaffold backend, docker-compose postgres+pgvector`.

---

## Task 2: Database models + schema

**Files:** Create `backend/app/db.py`, `backend/app/models.py`; extend `backend/sql/001_init.sql`; `backend/tests/conftest.py`, `backend/tests/test_models.py`.

**Step 1 — `db.py`:** SQLAlchemy 2 engine from `settings.database_url`, `sessionmaker`, `Base`, `get_session` dependency.

**Step 2 — `models.py`:** ORM for all tables in the design doc. Vector columns via `from pgvector.sqlalchemy import Vector` → `Vector(512)`. Tables: `Photo`, `ImageEmbedding`, `Face`, `Person`, `FacePerson`, `SimCluster`, `PhotoSimCluster`, `Scan`. `photos.sha256` UNIQUE. Store `bbox` as JSON/ARRAY(Float).

**Step 3 — `001_init.sql`:** add `CREATE TABLE` DDL mirroring models + `ivfflat` cosine indexes:
```sql
CREATE INDEX ON image_embeddings USING ivfflat (vec vector_cosine_ops) WITH (lists=100);
CREATE INDEX ON faces USING ivfflat (vec vector_cosine_ops) WITH (lists=100);
```

**Step 4 — test:** `conftest.py` spins a session against the compose DB (skip if unreachable). `test_models.py`: insert a `Photo` with a random 512-vec embedding, read back, assert round-trip + cosine query works. Run → fail → implement → pass.

**Step 5 — commit:** `feat: db models and pgvector schema`.

---

## Task 3: Scanner (walk, hash, thumbnail)

**Files:** Create `backend/app/scanner.py`, `backend/tests/fixtures/` (a few tiny jpgs), `backend/tests/test_scanner.py`.

**Behavior:** `iter_images(root) -> Iterator[Path]` filters extensions (`.jpg .jpeg .png .webp .heic`). `file_sha256(path) -> str`. `make_thumbnail(path, out_dir, size=256) -> Path`. `load_image(path) -> PIL.Image` with `pillow_heif.register_heif_opener()`.

**Tests (TDD):** hashing is stable; thumbnail created at ≤256px; corrupt file raises a caught error type; HEIC opener registered. One test per behavior, fail-first.

**Commit:** `feat: image scanner — walk, hash, thumbnail`.

---

## Task 4: Analyzer — CLIP image embeddings

**Files:** Create `backend/app/analyzer.py` (CLIP part), `backend/tests/test_clip.py`.

**Behavior:** lazy-load `open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")`, device = `"mps"` if available else `"cpu"`. `embed_images(pil_images: list) -> np.ndarray [N,512]`, L2-normalized, batched (32).

**Tests:** embed 2 fixture images → shape `(2,512)`, norms ≈ 1, identical image gives cosine ≈ 1. Mark model test `@pytest.mark.slow` (downloads weights). Fail-first on shape with a stub, then real impl.

**Commit:** `feat: CLIP image embeddings on MPS`.

---

## Task 5: Analyzer — InsightFace faces

**Files:** Extend `backend/app/analyzer.py`, `backend/tests/test_faces.py`, add one fixture photo containing a face.

**Behavior:** lazy-load `insightface.app.FaceAnalysis(name="buffalo_l")`, `prepare(ctx_id=0)`. `detect_faces(pil) -> list[{bbox, det_score, vec(512 normalized)}]`.

**Tests:** face image → ≥1 face with 512-vec; blank image → 0 faces. Mark slow (weights download).

**Commit:** `feat: InsightFace detection + ArcFace embeddings`.

---

## Task 6: Scan orchestration + scan API

**Files:** Create `backend/app/api/scan.py`, `backend/app/schemas.py`; wire router in `main.py`; `backend/tests/test_scan_api.py`.

**Behavior:** `POST /scan {root_path}` creates a `Scan` row (status=running), launches a `BackgroundTask` that runs the pipeline: for each image → hash (skip if exists) → thumbnail → CLIP embed → face embed → persist rows → increment `scans.done`. On corrupt image set `photos.error`, continue. On crash set `status=failed`. `GET /scan/{id}` returns progress.

**Tests:** POST a fixtures dir → poll `GET /scan/{id}` → eventually `status=completed`, `done==total`, photos+embeddings present. Use real small fixture set (mark slow) or monkeypatch analyzer with fakes for a fast unit test — include both.

**Commit:** `feat: scan pipeline and scan API with progress`.

---

## Task 7: Clusterer (HDBSCAN) + persist

**Files:** Create `backend/app/clusterer.py`, `backend/tests/test_clusterer.py`.

**Behavior:** `cluster_faces(session)` loads all face vecs → `HDBSCAN(metric="cosine", min_cluster_size=3)` → create/update `persons` for each label, assign via `face_person`; label -1 → unsorted (no person). `cluster_images(session)` same for CLIP vecs → `sim_clusters` + `photo_sim_cluster`. Re-cluster preserves named persons by matching centroids (cosine) to existing named persons above a threshold.

**Tests (fast, synthetic):** build 3 tight gaussian blobs of 512-vecs → expect 3 clusters + correct assignment; add outliers → unsorted. Name-preservation test: name a cluster, re-run, assert name kept.

**Commit:** `feat: HDBSCAN clustering for faces and images`.

---

## Task 8: Persons API

**Files:** Create `backend/app/api/persons.py`; wire router; `backend/tests/test_persons_api.py`.

**Endpoints:** `GET /persons` (clusters + names + cover thumb + count), `GET /persons/{id}/photos`, `PATCH /persons/{id} {name}`, `POST /persons/merge {ids[]}`, `POST /faces/move {face_ids[], person_id|null}`.

**Tests:** seed persons/faces, exercise rename, merge (faces reassigned, old person gone), move (split off faces to new/other person). Fail-first per endpoint.

**Commit:** `feat: persons API — list, rename, merge, move`.

---

## Task 9: Similarity API

**Files:** Create `backend/app/api/sim.py`; wire router; `backend/tests/test_sim_api.py`.

**Endpoints:** `GET /sim-clusters` (groups + cover + count), `GET /photos/{id}/similar?k=50` (pgvector cosine kNN via `vec.cosine_distance`).

**Tests:** seed image embeddings, assert similar returns nearest first, respects `k`.

**Commit:** `feat: similarity clusters and kNN API`.

---

## Task 10: Media serving

**Files:** Create `backend/app/api/media.py`; wire router; `backend/tests/test_media_api.py`.

**Endpoints:** `GET /thumb/{photo_id}` and `GET /image/{photo_id}` → `FileResponse`, 404 if missing.

**Tests:** seed a photo with thumb on disk → 200 + image content-type; unknown id → 404.

**Commit:** `feat: thumbnail and full-image serving`.

---

## Task 11: Frontend scaffold + scan screen

**Files:** Create `frontend/` Vite React-TS app, `src/api.ts`, `src/App.tsx`, `src/components/ScanBar.tsx`. Vite dev proxy `/` → `http://localhost:8000`.

**Behavior:** text input for folder path + "Scan" button → `POST /scan`; poll progress bar until complete. Tabs: **People** | **Similar**.

**Test:** component smoke test (Vitest + Testing Library) — ScanBar renders, calls api on submit (mock fetch).

**Commit:** `feat: frontend scaffold, scan bar and progress`.

---

## Task 12: People view

**Files:** Create `src/components/PeopleGrid.tsx`, `src/components/PersonDetail.tsx`.

**Behavior:** grid of person cover thumbs + name + count; click → detail grid of that person's photos; inline rename (PATCH); multi-select persons → Merge; in detail, select faces → Move to new/other person.

**Test:** renders persons from mocked API; rename fires PATCH.

**Commit:** `feat: people view with rename, merge, split`.

---

## Task 13: Similarity view

**Files:** Create `src/components/SimilarGrid.tsx`.

**Behavior:** grid of similarity clusters; click cluster → photos; click a photo → "more like this" via `/photos/{id}/similar`.

**Test:** renders clusters from mocked API.

**Commit:** `feat: similarity view and more-like-this`.

---

## Task 14: End-to-end + README

**Files:** `backend/tests/test_e2e.py` (marked slow), `README.md`.

**Behavior:** README with setup: `docker compose up -d db`, backend `uv`/`pip install` + `uvicorn app.main:app`, frontend `npm i && npm run dev`, point to a folder, scan, browse. E2E: scan fixtures → cluster → assert persons and sim-clusters exist via API.

**Commit:** `docs: README and end-to-end test`.

---

## Quality Gate (every task)

- Run that task's tests (`pytest -v` / `npm test`), confirm green before commit.
- Fast unit tests run without model downloads (fakes/monkeypatch); model-dependent tests marked `slow`.
- Commit after each task. Keep DRY/YAGNI.
