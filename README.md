# Photo Clustering App

A local web app that scans a folder of photos (built for 2k–10k images) and
groups them two ways:

- **People** — detects and embeds faces (InsightFace / ArcFace) and clusters
  them into persons you can **name**, **merge**, and split.
- **Similar** — embeds whole images (CLIP) and clusters visually similar
  photos, with a **"more like this"** nearest-neighbour search for any photo.

Everything runs locally. Your photos never leave your machine.

## Architecture

Split into three deployables plus the database. The heavy ML **worker** runs
natively on the host (for Apple-Silicon MPS); the light **API**, the **frontend
gateway**, and **Postgres** run in Docker.

```
                            ┌──────────────────────────────┐
                            │  Frontend + nginx gateway     │  Docker :80
  browser ────────────────► │  serves SPA, proxies by path  │
                            └───────┬───────────────┬───────┘
          /persons /sim-clusters    │               │   /scan /cluster /pick-folder
          /photos /faces /health    │               │   /thumb /face-thumb /image
                            ┌───────▼──────┐   ┌─────▼──────────────────────┐
                            │  API         │   │  Worker (native host) :8001 │
                            │  (Docker)    │   │  CLIP + InsightFace (MPS)   │
                            │  persons+sim │   │  HDBSCAN + media files      │
                            │  :8000       │   └─────┬──────────────────────┘
                            └───────┬──────┘         │
                                    │ SQLAlchemy      │ SQLAlchemy
                                 ┌──▼─────────────────▼──┐
                                 │ Postgres + pgvector     │  Docker :5432
                                 └─────────────────────────┘
```

- **Worker** (native, `app.main_worker`) — owns everything heavy or host-bound:
  the scan pipeline (CLIP `open_clip` ViT-B/32 image embeddings, InsightFace
  `buffalo_l` face detect+embed), HDBSCAN/DBSCAN clustering, the native folder
  picker, and serving thumbnail/original image files. Runs natively so it can use
  Apple Silicon's **MPS** GPU — Docker Desktop on macOS has no GPU/MPS access, so
  containerising the models would force slow CPU inference. Needs the `worker`
  dependency extra (torch, insightface, …).
- **API** (Docker, `app.main_api`) — the light, DB-only surface: persons and
  similarity clusters. Pulls **none** of the ML stack, so the image is small and
  portable. Base deps only.
- **Frontend + gateway** (Docker) — React + Vite built to static files, served by
  nginx which also reverse-proxies each backend path to the right service, so the
  browser sees a single origin (no CORS).
- **Postgres + pgvector** — photo metadata + 512-d embeddings, cosine kNN for
  similarity. Runs in Docker.

## Prerequisites

- **Docker** (Postgres, API, frontend gateway)
- **Python 3.11** (native worker)
- **Node.js** (18+) and npm (only if running the frontend in dev mode)

## Setup

### 1. Start the Dockerised pieces (db + api + frontend gateway)

```bash
docker compose up -d --build
```

This boots:
- `db` — `pgvector/pgvector:pg16` on `localhost:5432` (`photo` / `photo` / db
  `photos`), applying `backend/sql/001_init.sql`.
- `api` — the slim persons/similarity API (internal `:8000`).
- `frontend` — the SPA + nginx gateway on **http://localhost** (`:80`). It proxies
  `/scan`, `/cluster`, `/pick-folder`, `/thumb`, `/face-thumb`, `/image` to the
  native worker, and everything else to `api`.

### 2. Run the native ML worker

```bash
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -e '.[worker,dev]'

# Serve the worker (reload for development):
PHOTO_DATABASE_URL=postgresql+psycopg://photo:photo@localhost:5432/photos \
  .venv/bin/python -m uvicorn app.main_worker:app --reload --port 8001
```

> **First run downloads model weights (~1 GB)** for CLIP and InsightFace and
> caches them under your home directory. This is a one-time cost. Because
> Docker-on-Mac has no MPS, the worker runs **natively** so it can use the
> Apple Silicon GPU.

Check it's up: `curl localhost:8001/health` → `{"status":"ok"}`, and the gateway
`curl localhost/health` → `{"status":"ok"}` (served by `api`).

Open **http://localhost**.

### Dev alternative: run everything natively

For a tight edit loop you can skip the api/frontend containers and run the
combined app + Vite dev server instead (only `db` needs Docker):

```bash
docker compose up -d db
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
cd frontend && npm install && VITE_API_BASE=http://localhost:8000 npm run dev
```

`app.main` mounts every router in one process; `VITE_API_BASE` points the Vite
dev server (`:5173`) straight at it.

## Usage

1. Paste the **absolute path** of a photo folder into the input and click
   **Scan**. The backend walks the folder, hashes + thumbnails each image,
   embeds images and faces, and shows live progress. When the scan completes it
   automatically clusters.
2. Browse the **People** tab — each card is a detected person. Click a card to
   see their photos; type a name and **Save** to label them. Use **Select** to
   multi-select cards and **Merge** persons that are the same individual.
3. Browse the **Similar** tab — each card is a visual-similarity cluster. Click
   a cluster to see its photos, then click any photo for **"more like this"**
   nearest-neighbour results.

Scanning is **idempotent** (photos are keyed by content SHA-256), so re-scanning
a folder is safe and only processes new files. Re-clustering preserves the names
you've assigned.

## Tests

The suite is end-to-end against the real backend, real Postgres and real models
(no unit tests). Fixtures live in `backend/tests/fixtures/` and are generated by
`backend/tests/make_fixtures.py`.

### Backend API e2e (pytest + FastAPI TestClient)

Requires the Docker Postgres to be running (`docker compose up -d db`); if it's
unreachable the suite skips with a message.

```bash
cd backend
.venv/bin/python -m pytest tests/test_e2e.py -v
```

It scans the fixtures, clusters, and asserts: scan completes with no errors,
≥1 person cluster and ≥1 similarity cluster are formed, persons list / rename /
photos work, similarity kNN returns near-duplicates nearest-first (query
excluded), and the thumbnail/image endpoints serve bytes (unknown id → 404).

To regenerate the fixtures:

```bash
cd backend && .venv/bin/python -m tests.make_fixtures
```

### UI e2e (Playwright)

Playwright starts both servers itself (see `frontend/playwright.config.ts`) and
drives a real Chromium browser through a scan, People browsing + rename, and the
Similar / "more like this" flow.

```bash
cd frontend
npm install
npx playwright install chromium   # first time only
npx playwright test
```
