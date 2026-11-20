-- Users: credentials for the single admin account that gates curation and the
-- worker functions. Passwords are stored only as a PBKDF2-SHA256 hash
-- (app/auth.py); plaintext is never persisted. Seed with scripts/seed_admin.py.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
