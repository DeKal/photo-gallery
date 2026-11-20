-- Focus measure per face (variance of the Laplacian over the grayscale crop).
-- Computed at scan time and read by clustering to drop out-of-focus faces.
-- Null until backfilled (see scripts/backfill_sharpness.py) or re-scanned.
ALTER TABLE faces ADD COLUMN IF NOT EXISTS sharpness double precision;
