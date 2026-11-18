# Architecture

PhotoCluster groups a photo library by **face** (who is in each photo) and by
**visual similarity** (near-duplicate / same-scene sets), and lets you browse and
curate the result. This document describes the system's shape: its components,
how data flows through them, and the two deployment topologies (full local stack
vs. the no-worker Vercel viewer).

## Components

| Component | Tech | Role |
|---|---|---|
| **Frontend** | React 18 + Vite + TypeScript, Tailwind (Material-3 tokens) | SPA: People / Similar / All Photos views, lightbox, curation UI. |
| **Worker** | FastAPI (`app.main_worker`), native host process | Heavy ML + ingest: scan pipeline, CLIP + InsightFace embedding, clustering, Google Drive download, folder picker. Serves original images. |
| **API** | FastAPI (`app.main_api`), slim Docker / serverless | DB-only surface: persons, similarity, photos, and in-DB thumbnails. No ML stack. |
| **Database** | Postgres + pgvector | Source of truth: photos, embeddings, faces, persons, clusters, thumbnail bytes. |
| **Gateway** | nginx (local) / Vercel rewrites (prod) | One origin; routes paths to worker vs. API. |
| **Google Drive** | — | Optional source of originals; also the display source for full-resolution images in the browser. |

The split line is deliberate: the API's routers (`persons`, `sim`, `photos`,
`media`) import only `db` / `models` / `schemas`, never `analyzer` / `clusterer`
/ `pipeline` / Pillow. So the API image carries none of torch/InsightFace/CLIP and
stays small and portable (including serverless).

### Three app entrypoints, one package

All three import the same `app` package (shared `db`, `models`, `schemas`,
`config`); they differ only in which routers they mount:

- `app.main_worker` — `scan`, `cluster`, `media` + the pipeline/analyzer/clusterer.
- `app.main_api` — `persons`, `sim`, `photos`, `media`, `/health`.
- `app.main` — the combined all-in-one, for simple local dev.

`media` is mounted by both the worker and the API. On the worker it can read
original files and face crops from disk; on the API it serves thumbnail **bytes**
stored in the database (see below), so it needs no shared filesystem.

## Data model

```mermaid
erDiagram
    photos ||--|| image_embeddings : "CLIP vec"
    photos ||--o{ faces : "detected in"
    faces ||--o| face_person : "assigned"
    face_person }o--|| persons : "belongs to"
    photos ||--o| photo_sim_cluster : "grouped"
    photo_sim_cluster }o--|| sim_clusters : "into"
    photos ||--o{ photo_album : "in"
    photo_album }o--|| albums : "collects"

    photos {
        int id PK
        text sha256 UK
        bytea thumb_data
        text drive_file_id
        text path
        int width
        int height
        timestamp taken_at
    }
    image_embeddings {
        int photo_id PK "FK to photos"
        vector vec "512-dim CLIP"
    }
    faces {
        int id PK
        int photo_id FK
        float bbox
        float det_score
        vector vec "512-dim"
        bytea thumb_data
    }
    face_person {
        int face_id PK "FK to faces"
        int person_id FK
    }
    persons {
        int id PK
        text name
        int cover_face_id FK
        bool hidden
        bool locked
    }
    sim_clusters {
        int id PK
        text label
    }
    photo_sim_cluster {
        int photo_id PK "FK to photos"
        int sim_cluster_id FK
    }
    scans {
        int id PK
        text root_path
        text status
        int done
        int total
        int album_id FK
    }
    albums {
        int id PK
        text name
        timestamp created_at
    }
    photo_album {
        int photo_id PK "FK to photos"
        int album_id PK "FK to albums"
    }
```

Key points:

- **`sha256`** keys a photo by content, so re-scanning a folder is idempotent.
- **Vectors** are pgvector `vector(512)` with ivfflat cosine indexes; queries set
  `ivfflat.probes = 50` per connection for near-exact recall at this scale.
- **`thumb_data`** (on `photos` and `faces`) holds the JPEG bytes of the 512 px
  photo thumbnail / 256 px face crop. Storing them in the DB removes the only
  shared-filesystem dependency of the read path, which is what makes serverless
  deployment possible. `thumb_path` remains as a local-dev fallback.
- **`drive_file_id`** links a photo to its Google Drive file so the browser can
  display the full-resolution image straight from Drive.
- **`persons.locked`** marks a curated person; locked persons are preserved
  verbatim across re-clustering instead of being rebuilt.
- **`albums`** are user-named collections; `photo_album` is a many-to-many join,
  so a photo can sit in several albums. A scan may carry an `album_id`, in which
  case every photo it touches (new or already-indexed) is added to that album —
  "scan this folder straight into *Wedding*". Album create/rename/delete and
  manual add/remove are plain DB writes, so they work in the no-worker viewer
  too.

## Data flow

### Ingest (worker only)

```mermaid
flowchart TD
    A([Folder path or Drive URL]) -->|Drive URL| B[gdown downloads folder<br/>to local staging dir]
    A -->|local path| C
    B --> C{{iter_images}}
    C --> D{New file?<br/>keyed by sha256}
    D -->|already indexed| C
    D -->|new| E[make 512px thumbnail<br/>→ thumb_data bytes]
    E --> F[CLIP embed<br/>→ image_embeddings]
    F --> G[InsightFace detect<br/>→ faces + 256px crop thumb_data]
    G --> C
    C -->|all files done| H{{cluster}}
    H --> I[DBSCAN/HDBSCAN over face vecs<br/>→ persons + face_person]
    H --> J[similarity over image vecs<br/>→ sim_clusters + photo_sim_cluster]
```

Scanning runs in a background thread, committing every 10 files and updating
`scans.done` so the UI can poll progress. Per-file failures are recorded on
`photos.error` and never abort the run.

### Display (read path)

- **Lists** (People, Similar, All Photos): the frontend calls the API, which reads
  Postgres and returns JSON. Each photo/face carries its `drive_file_id`.
- **Thumbnails / face crops**: `GET /thumb/{id}` and `/face-thumb/{id}` return the
  `thumb_data` bytes with a long-lived `Cache-Control`, so browsers and any CDN
  cache them and a grid of many thumbnails doesn't re-hit the backend.
- **Full-resolution photo** (lightbox): the frontend builds an ordered source list
  `[driveImageUrl, imageUrl]`. A Drive-backed photo loads full-res directly from
  Google (`lh3.googleusercontent.com/d/<id>`); otherwise it falls back to the
  worker's `GET /image/{id}` (the original file on disk). All image tags use
  `referrerPolicy="no-referrer"` — sending a `Referer` to Drive triggers HTTP 429.

```mermaid
flowchart LR
    FE[Frontend]
    API[API]
    DB[(Postgres)]
    DRIVE[Google Drive<br/>lh3.googleusercontent.com]
    WK[Worker disk]

    FE -->|lists: /persons /sim-clusters /photos| API
    API --> DB
    FE -->|/thumb/id, /face-thumb/id| API
    API -.->|thumb_data bytes + Cache-Control| FE
    FE ==>|"full-res: driveImageUrl (1st)"| DRIVE
    FE -.->|"fallback: /image/id"| WK
```

## Deployment topologies

### Full local stack

```mermaid
flowchart TD
    B[Browser] --> GW[nginx gateway<br/>:8080]
    GW -->|"/scan /cluster /pick-folder<br/>/thumb /face-thumb /image"| WK[Worker<br/>native host :8001]
    GW -->|"/persons /faces /sim-clusters<br/>/photos /health"| API[API container<br/>:8000]
    WK --> DB[(Postgres + pgvector<br/>container :5432)]
    API --> DB
    WK -.->|MPS · osascript picker<br/>photo library| HOST[Host resources]

    subgraph compose["docker compose -p photo-app"]
        GW
        API
        DB
    end
```

The worker runs natively (not containerized) to keep Apple-Silicon MPS, the
`osascript` folder picker, and direct access to the photo library. `db` and `api`
and the `frontend`/gateway run under `docker compose -p photo-app`. Single origin
through nginx means no CORS in normal use.

### No-worker viewer on Vercel

```mermaid
flowchart TD
    B[Browser] --> V{{Vercel edge}}
    V -->|/| SPA[Static SPA<br/>frontend/dist]
    V -->|/api/*  rewrite| FN[Python serverless fn<br/>api/index.py → app.main_api]
    FN -->|pooled connection<br/>NullPool| NEON[(Neon<br/>Postgres + pgvector)]
    B ==>|full-res images<br/>client-side| DRIVE[Google Drive]
```

What changes versus local:

- **No worker.** Scan / cluster / folder import / original-image serving are not
  deployed. The data is prepared locally and loaded into Neon; prod is browse +
  curate only. The frontend hides scan UI when `VITE_NO_WORKER=1`.
- **Single function, mounted under `/api`.** `api/index.py` mounts `app.main_api`
  at `/api` and the frontend sets `VITE_API_BASE=/api`, so `/api/persons` →
  `/persons` inside the app. `vercel.json` rewrites `/api/*` to the function;
  everything else is the static SPA (one origin, no CORS).
- **Connectionless engine.** `api/index.py` forces `PHOTO_SERVERLESS=1`, so
  `app.db` builds the engine with `NullPool`. Each short-lived invocation opens
  and closes its own connection and relies on Neon's pooled endpoint, instead of
  keeping a per-instance pool that would exhaust Neon's connection limit across
  cold starts.
- **Images.** Thumbnails come from `thumb_data` in Neon; full-resolution comes from
  Drive. `/image/{id}` has no files to serve in this topology and 404s — benign,
  because the lightbox tries Drive first.

See `docs/deploy-vercel.md` for the step-by-step deploy process.

## Design decisions worth knowing

- **Thumbnails in the DB.** Trades a larger database (~370 MB for ~1,800 photos +
  ~10,000 faces) for a stateless read path that deploys anywhere. The alternative
  — object storage (S3/R2/Vercel Blob) — scales better but adds a service and a
  migration; the DB approach is the simplest thing that makes serverless work.
- **Drive for originals.** Keeps multi-GB originals out of the DB and off the
  server. Caveat: Drive's image endpoints are undocumented and rate-limit bulk
  hotlinking, so they suit a personal viewer, not a high-traffic gallery.
- **Worker stays native.** The ML stack wants a real, long-running process (and
  ideally a GPU/MPS). It is intentionally excluded from the serverless and slim
  Docker surfaces rather than forced into them.
