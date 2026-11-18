CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    width INTEGER,
    height INTEGER,
    taken_at TIMESTAMP,
    thumb_path TEXT,
    thumb_data BYTEA,
    drive_file_id TEXT,
    error TEXT,
    scanned_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS image_embeddings (
    photo_id INTEGER PRIMARY KEY REFERENCES photos(id),
    vec vector(512)
);

CREATE TABLE IF NOT EXISTS faces (
    id SERIAL PRIMARY KEY,
    photo_id INTEGER NOT NULL REFERENCES photos(id),
    bbox REAL[],
    det_score DOUBLE PRECISION,
    vec vector(512),
    thumb_path TEXT,
    thumb_data BYTEA
);

CREATE TABLE IF NOT EXISTS persons (
    id SERIAL PRIMARY KEY,
    name TEXT,
    cover_face_id INTEGER REFERENCES faces(id),
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    locked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS face_person (
    face_id INTEGER PRIMARY KEY REFERENCES faces(id),
    person_id INTEGER NOT NULL REFERENCES persons(id)
);

CREATE TABLE IF NOT EXISTS sim_clusters (
    id SERIAL PRIMARY KEY,
    label TEXT
);

CREATE TABLE IF NOT EXISTS photo_sim_cluster (
    photo_id INTEGER PRIMARY KEY REFERENCES photos(id),
    sim_cluster_id INTEGER NOT NULL REFERENCES sim_clusters(id)
);

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

CREATE TABLE IF NOT EXISTS scans (
    id SERIAL PRIMARY KEY,
    root_path TEXT NOT NULL,
    status TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    album_id INTEGER REFERENCES albums(id)
);

CREATE INDEX IF NOT EXISTS idx_image_emb_vec ON image_embeddings USING ivfflat (vec vector_cosine_ops) WITH (lists=100);
CREATE INDEX IF NOT EXISTS idx_faces_vec ON faces USING ivfflat (vec vector_cosine_ops) WITH (lists=100);
