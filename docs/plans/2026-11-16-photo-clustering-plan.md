# Photo Clustering App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local web app that scans a photo folder (2k–10k images) and groups images by person (face recognition) and by visual similarity, with a browsable UI that can name, merge, and split person clusters.

**Architecture:** FastAPI backend runs natively on the host (Apple Silicon, MPS). PostgreSQL + `pgvector` runs in docker-compose and stores metadata and 512-d embeddings. CLIP embeds whole images; InsightFace detects and embeds faces. HDBSCAN clusters each embedding set. A React + Vite frontend talks to the backend over REST.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2, psycopg, pgvector, open_clip, insightface, onnxruntime, hdbscan, Pillow + pillow-heif, pytest + httpx. Frontend: React, Vite, TypeScript. Postgres 16 + pgvector via Docker.

**Design doc:** `docs/plans/2026-11-16-photo-clustering-design.md`

## Testing policy (per user)

- **No unit tests. No TDD. No frontend tests.**
- Verify the backend with **integration / end-to-end API tests** that hit the real
  running app against the real Postgres (docker-compose) with a small fixture image set.
- Each backend task builds the feature, then is verified later by the integration
  suite in **Task 14**. Individual tasks do a quick manual/smoke check (curl or a short
  script) and commit; they do not write unit tests.
- Model-dependent steps (CLIP, InsightFace) download weights on first run — that is
  expected and exercised by the e2e test.

**Execution note:** Each Task is a self-contained unit sized for one subagent. Dispatch one subagent per Task, review, commit, then spawn the next. Tasks are dependency-ordered.

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
  tests/ conftest.py  fixtures/  test_e2e.py
frontend/
  package.json  vite.config.ts  index.html
  src/ main.tsx  App.tsx  api.ts  components/
```

---

## Task 1: Scaffold + Postgres/pgvector in docker-compose

**Files:** `docker-compose.yml`; `backend/pyproject.toml`; `backend/app/__init__.py`, `config.py`, `main.py`; `backend/sql/001_init.sql`; `.gitignore`.

**docker-compose.yml:**
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

**`sql/001_init.sql`:** `CREATE EXTENSION IF NOT EXISTS vector;` (tables added in Task 2).

**`pyproject.toml`** deps: fastapi, uvicorn[standard], sqlalchemy>=2, psycopg[binary], pgvector, pydantic-settings, pillow, pillow-heif, numpy, open_clip_torch, torch, insightface, onnxruntime, hdbscan, scikit-learn, pytest, httpx.

**`config.py`:** `pydantic-settings` `Settings`: `database_url` (default `postgresql+psycopg://photo:photo@localhost:5432/photos`), `data_dir` (`~/.photo-app`), `thumb_dir`.

**`main.py`:** FastAPI app with `GET /health -> {"status":"ok"}`.

**Verify:** `docker compose up -d db`; create venv, install fastapi+uvicorn+httpx; `uvicorn app.main:app` then `curl localhost:8000/health` → `{"status":"ok"}`.

**Commit:** `feat: scaffold backend, docker-compose postgres+pgvector`.

---

## Task 2: Database models + schema

**Files:** `backend/app/db.py`, `backend/app/models.py`; extend `backend/sql/001_init.sql`.

**`db.py`:** SQLAlchemy 2 engine from `settings.database_url`, `sessionmaker`, `Base`, `get_session` FastAPI dependency.

**`models.py`:** ORM for all design-doc tables. Vectors via `from pgvector.sqlalchemy import Vector` → `Vector(512)`. Tables: `Photo`, `ImageEmbedding`, `Face`, `Person`, `FacePerson`, `SimCluster`, `PhotoSimCluster`, `Scan`. `photos.sha256` UNIQUE. `bbox` as ARRAY(Float)/JSON.

**`001_init.sql`:** add `CREATE TABLE` DDL mirroring models + ivfflat cosine indexes:
```sql
CREATE INDEX ON image_embeddings USING ivfflat (vec vector_cosine_ops) WITH (lists=100);
CREATE INDEX ON faces USING ivfflat (vec vector_cosine_ops) WITH (lists=100);
```

**Verify:** recreate DB (`docker compose down -v && up -d db`); short python snippet inserts a Photo + random 512 vec, reads back, runs a cosine query. Confirm round-trip.

**Commit:** `feat: db models and pgvector schema`.

---

## Task 3: Scanner (walk, hash, thumbnail)

**Files:** `backend/app/scanner.py`.

**Behavior:** `iter_images(root)` filters `.jpg .jpeg .png .webp .heic`; `file_sha256(path)`; `make_thumbnail(path, out_dir, size=256) -> Path`; `load_image(path)` with `pillow_heif.register_heif_opener()`. Corrupt file → raise a defined exception for the caller to catch.

**Verify:** run module against a temp dir of 2–3 images; confirm hashes stable and thumbnails written ≤256px.

**Commit:** `feat: image scanner — walk, hash, thumbnail`.

---

## Task 4: Analyzer — CLIP + InsightFace

**Files:** `backend/app/analyzer.py`.

**CLIP:** lazy-load `open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")`, device `"mps"` if available else `"cpu"`. `embed_images(pils) -> np.ndarray [N,512]`, L2-normalized, batch 32.

**Faces:** lazy-load `insightface.app.FaceAnalysis(name="buffalo_l")`, `prepare(ctx_id=0)`. `detect_faces(pil) -> list[{bbox, det_score, vec(512 normalized)}]`.

**Verify:** script embeds 2 images → shape `(2,512)`, norms≈1, same image cosine≈1; a face photo → ≥1 face vec, blank → 0. (First run downloads weights.)

**Commit:** `feat: CLIP image + InsightFace face embeddings on MPS`.

---

## Task 5: Scan orchestration + scan API

**Files:** `backend/app/api/scan.py`, `backend/app/schemas.py`; wire router in `main.py`.

**Behavior:** `POST /scan {root_path}` → create `Scan` (status=running), launch `BackgroundTask` pipeline: per image → hash (skip if exists) → thumbnail → CLIP embed → face embed → persist → `scans.done++`. Corrupt image → set `photos.error`, continue. Crash → `status=failed`. `GET /scan/{id}` → progress.

**Verify:** `POST /scan` on the fixtures dir, poll `GET /scan/{id}` to `completed`, confirm rows exist.

**Commit:** `feat: scan pipeline and scan API with progress`.

---

## Task 6: Clusterer (HDBSCAN) + persist

**Files:** `backend/app/clusterer.py`; expose `POST /cluster` in an API module (or within scan).

**Behavior:** `cluster_faces(session)` → `HDBSCAN(metric="cosine", min_cluster_size=3)` on face vecs → create/update `persons`, assign via `face_person`; label -1 → unsorted. `cluster_images(session)` → `sim_clusters` + `photo_sim_cluster`. Re-cluster preserves named persons by matching centroids (cosine) to existing named persons above a threshold.

**Verify:** after a scan, run clustering; confirm persons + sim_clusters created; name a person, re-run, name preserved.

**Commit:** `feat: HDBSCAN clustering for faces and images`.

---

## Task 7: Persons API

**Files:** `backend/app/api/persons.py`; wire router.

**Endpoints:** `GET /persons` (clusters + names + cover thumb + count), `GET /persons/{id}/photos`, `PATCH /persons/{id} {name}`, `POST /persons/merge {ids[]}`, `POST /faces/move {face_ids[], person_id|null}`.

**Verify:** curl each endpoint against seeded data; rename, merge, move behave.

**Commit:** `feat: persons API — list, rename, merge, move`.

---

## Task 8: Similarity + media API

**Files:** `backend/app/api/sim.py`, `backend/app/api/media.py`; wire routers.

**Endpoints:** `GET /sim-clusters`; `GET /photos/{id}/similar?k=50` (pgvector `vec.cosine_distance` kNN); `GET /thumb/{photo_id}` and `GET /image/{photo_id}` → `FileResponse`, 404 if missing.

**Verify:** curl similar returns nearest first; thumb/image return bytes; unknown id → 404.

**Commit:** `feat: similarity kNN and media serving`.

---

## Task 9: Frontend scaffold + scan screen

**Files:** `frontend/` Vite React-TS app; `src/api.ts`, `src/App.tsx`, `src/components/ScanBar.tsx`. Vite dev proxy to `http://localhost:8000`.

**Behavior:** folder-path input + "Scan" → `POST /scan`; poll progress bar to complete. Tabs **People** | **Similar**. (No tests.)

**Commit:** `feat: frontend scaffold, scan bar and progress`.

---

## Task 10: People view

**Files:** `src/components/PeopleGrid.tsx`, `src/components/PersonDetail.tsx`.

**Behavior:** grid of person covers + name + count; click → person photos; inline rename (PATCH); multi-select → Merge; in detail, select faces → Move to new/other person.

**Commit:** `feat: people view with rename, merge, split`.

---

## Task 11: Similarity view

**Files:** `src/components/SimilarGrid.tsx`.

**Behavior:** grid of similarity clusters; click → photos; click a photo → "more like this" via `/photos/{id}/similar`.

**Commit:** `feat: similarity view and more-like-this`.

---

## Task 12: Integration / E2E API tests + README

**Files:** `backend/tests/conftest.py`, `backend/tests/fixtures/` (small real image set incl. ≥1 face + near-dupes), `backend/tests/test_e2e.py`; `README.md`.

**`conftest.py`:** fixture that ensures Postgres reachable (skip suite with clear message if not), resets tables between runs, and provides an `httpx` client bound to the app.

**`test_e2e.py` (real app, real DB, real models — marked `slow`):**
1. `POST /scan` on fixtures dir → poll `GET /scan/{id}` to `completed`; assert `done==total`, photos + embeddings + faces persisted.
2. Run clustering → assert ≥1 person and ≥1 sim-cluster.
3. `GET /persons` non-empty; `PATCH` rename; `POST /persons/merge`; `POST /faces/move` — assert state changes.
4. `GET /sim-clusters` non-empty; `GET /photos/{id}/similar?k=5` returns nearest-first.
5. `GET /thumb/{id}` and `GET /image/{id}` → 200 image bytes; unknown id → 404.

**README:** setup — `docker compose up -d db`; backend install + `uvicorn app.main:app`; frontend `npm i && npm run dev`; point to a folder, scan, browse. How to run e2e: `pytest -m slow`.

**Verify:** `pytest backend/tests/test_e2e.py -v` green against docker DB.

**Commit:** `test: end-to-end API suite; docs: README`.

---

## Quality Gate (every task)

- Backend tasks: quick manual/curl smoke check that the feature works, then commit.
- No unit tests, no TDD, no FE tests.
- Final correctness gate = **Task 12** integration/e2e API suite must be green.
- Commit after each task (no push). DRY / YAGNI.
