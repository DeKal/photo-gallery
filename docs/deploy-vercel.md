# Deploying to Vercel (no-worker viewer)

This deploys the frontend and the DB-only API to Vercel, with Postgres on Neon.
The ML worker (scan / cluster / folder import / original-image serving) is **not**
deployed — the app runs as a browse-and-curate viewer. Thumbnails are served from
the database; full-resolution photos load from Google Drive in the browser.

## Prerequisites

- A [Neon](https://neon.tech) account (free tier is enough; the DB is ~370 MB).
- A [Vercel](https://vercel.com) account, and the repo pushed to a Git provider
  Vercel can import (GitHub/GitLab/Bitbucket).
- Local tools: the running local stack (`docker compose -p photo-app`) so you can
  dump the DB, plus `psql` and `pg_restore` (ship with the `postgresql` client
  package).
- Every photo you want visible full-screen must already have a `drive_file_id`
  (run `scripts/backfill_drive_ids.py` and `scripts/backfill_thumb_data.py` first).

## 1. Create the Neon database

1. In the Neon console, create a new project (Postgres 16).
2. Open **Connection details** and copy **two** connection strings:
   - the **direct** string (host without `-pooler`) — used for the one-time data
     load below;
   - the **pooled** string (host contains `-pooler`, ends with `?sslmode=require`)
     — used by the serverless API at runtime.

## 2. Load your data into Neon

From the repo root, with the local stack running:

```bash
# Dump the local DB (includes thumb_data bytes, pgvector vectors, and indexes).
docker exec photo-app-db-1 pg_dump -U photo -Fc photos > photos.dump

# Enable pgvector, then restore. Use the DIRECT (non-pooled) Neon URL here.
psql "$NEON_DIRECT_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
pg_restore --no-owner --no-acl -d "$NEON_DIRECT_URL" photos.dump
```

Verify the load:

```bash
psql "$NEON_DIRECT_URL" -c "SELECT
  (SELECT count(*) FROM photos) AS photos,
  (SELECT count(*) FROM photos WHERE thumb_data IS NOT NULL) AS photo_thumbs,
  (SELECT count(*) FROM faces  WHERE thumb_data IS NOT NULL) AS face_thumbs;"
```

`photo_thumbs` and `face_thumbs` should be non-zero — that is what the API serves.

`photos.dump` is gitignored; delete it when done.

## 2b. Create the admin account

Curation and the worker functions are admin-only (every mutating endpoint
requires a valid token; anonymous visitors browse read-only). The admin lives in
a `users` table — add it, then seed the account. Use the Neon **direct**
(non-pooled) URL:

```bash
# Add the users table (not in older dumps).
psql "$NEON_DIRECT_URL" -f backend/sql/007_add_users.sql

# Seed the admin (password stored only as a PBKDF2 hash; pick your own).
cd backend && PHOTO_DATABASE_URL="$NEON_DIRECT_URL" \
  .venv/bin/python ../scripts/seed_admin.py --username admin --password 'YOUR_PASSWORD'
```

Re-running `seed_admin.py` with the same username updates that account's
password. Tokens are signed with `PHOTO_AUTH_SECRET` (set in step 4) — the seeded
password and the secret are independent; changing the secret logs everyone out
but does not change the password.

## 3. Import the project into Vercel

1. In Vercel, **Add New → Project** and import the repository.
2. Leave the build settings at their defaults. The root `vercel.json` uses the
   **services** model and declares everything Vercel needs:
   - a `backend` service (`root: backend`, `framework: fastapi`, entrypoint
     `app.vercel_app:app`) — the DB-only API plus the SPA-shell / per-album
     social-preview routes;
   - a `frontend` service (`root: frontend`, `framework: vite`) — the static SPA;
   - `rewrites` that send static assets (`/assets/*`, `/icon.png`, `/og-image.png`,
     `/favicon.ico`, `/index.html`) to the frontend, and `/api/*` **plus every
     other path** to the backend (the backend serves the SPA shell for deep links,
     so a reload of `/all` or `/albums/12` resolves).

   Per-service nested `vercel.json` files are ignored under the services model —
   all config lives in the root file.

## 4. Set environment variables

In the Vercel project: **Settings → Environment Variables**. Add these for the
**Production** (and Preview, if you use previews) environment:

| Variable | Value | Notes |
|---|---|---|
| `PHOTO_DATABASE_URL` | Neon **pooled** connection string | Must be the `-pooler` host, `?sslmode=require`. Runtime DB connection. |
| `PHOTO_AUTH_SECRET` | a long random string | Signs admin session tokens (`app/auth.py`). Keep it secret and stable; rotating it invalidates existing logins. Generate e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`. |
| `VITE_NO_WORKER` | `1` | Build-time flag that hides the scan/import UI. Must be set **before** the build. |

`PHOTO_SERVERLESS` does not need to be set — `app.vercel_app` forces it on so the
API uses a connectionless (NullPool) engine suited to serverless.

## 5. Deploy

Trigger a deploy (push to the production branch, or **Deploy** in the dashboard).
Vercel will build the frontend and the backend services together.

## 6. Verify

Open the deployment URL and check:

- **People** and **Similar** tabs load their lists.
- Face chips and grid thumbnails render (served from the DB).
- Opening a photo shows full resolution (loaded from Google Drive).
- No **Scan** bar or **Import Folder** button appears.
- Curation still works if you use it (rename person, move faces, hide, label) —
  these write to Neon.
- A deep link reloads cleanly: open `/all` or `/albums/<id>` directly (not via
  in-app navigation) and the page renders instead of 404ing.
- Sharing an album link shows its own preview: paste `/albums/<id>` into the
  [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) (or
  Slack/iMessage) and confirm the album's title + cover, not the generic card.

Quick API smoke test:

```bash
curl -s https://<your-app>.vercel.app/api/health          # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
     https://<your-app>.vercel.app/api/thumb/1            # 200 image/jpeg

# Deep link + per-album OG meta (served by the backend, not the static build):
curl -s -o /dev/null -w "%{http_code}\n" https://<your-app>.vercel.app/all        # 200
curl -s https://<your-app>.vercel.app/albums/1 \
  | grep -iE '<title>|og:title|og:image'                 # album name + cover URL

# Auth: login issues a token; writes are rejected without one.
curl -s https://<your-app>.vercel.app/api/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"YOUR_PASSWORD"}'      # {"token":...}
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
     https://<your-app>.vercel.app/api/persons/1/hide          # 401 (no token)
```

## Updating the data later

Re-scan locally (worker on your machine), then repeat **Step 2** against Neon. To
replace rows cleanly you can truncate first, or drop and recreate the Neon
database and restore a fresh dump.

## Troubleshooting

- **`/api/...` returns 404 (lists empty, broken thumbnails).** The rewrite isn't
  passing the full path to the backend. Confirm `vercel.json` has the `/api/(.*)`
  → `backend` rewrite and that `app.vercel_app` mounts the app at `/api`. Test the
  exact path with the `curl` commands above.
- **Deep link 404s on reload (e.g. `/all`, `/albums/12`).** A client route is
  reaching the static frontend instead of the backend SPA-shell fallback. Confirm
  the root `vercel.json` routes non-asset paths to `backend` (the catch-all
  `/(.*)` → `backend`), and that asset rewrites don't swallow client routes.
- **500 / "too many connections".** `PHOTO_DATABASE_URL` is the direct host, not
  the pooled one. Switch to the `-pooler` string.
- **Thumbnails 404 but lists load.** The dump predates in-DB thumbnails. Run
  `scripts/backfill_thumb_data.py --apply` locally, then re-dump and restore.
- **Full photos blank in the lightbox.** Those rows have no `drive_file_id`, and
  originals aren't deployed. Backfill Drive ids, or accept that non-Drive photos
  have no full view in this deployment.
- **Scan bar still visible.** `VITE_NO_WORKER` was not set at build time. Set it
  and redeploy (it is compiled into the bundle, not read at runtime).
- **Neon storage near the limit.** The DB is ~370 MB against a 512 MB free tier.
  Lower thumbnail JPEG quality/size in `scanner.py` and re-backfill if you need
  headroom.
