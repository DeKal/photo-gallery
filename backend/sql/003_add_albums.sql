-- Albums: user-named collections of photos (many-to-many), plus an optional
-- album target on a scan so a folder can be ingested straight into an album.
CREATE TABLE IF NOT EXISTS albums (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_album (
    photo_id INTEGER NOT NULL REFERENCES photos(id),
    album_id INTEGER NOT NULL REFERENCES albums(id),
    PRIMARY KEY (photo_id, album_id)
);

ALTER TABLE scans ADD COLUMN IF NOT EXISTS album_id INTEGER REFERENCES albums(id);
