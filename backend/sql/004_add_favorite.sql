-- Per-photo favorite flag, toggled from the lightbox star.
ALTER TABLE photos ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
