-- Store thumbnail JPEG bytes in the database so media can be served without a
-- shared filesystem (serverless/Vercel). Backfill existing rows from disk with
-- scripts/backfill_thumb_data.py. Idempotent.
ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb_data BYTEA;
ALTER TABLE faces ADD COLUMN IF NOT EXISTS thumb_data BYTEA;
