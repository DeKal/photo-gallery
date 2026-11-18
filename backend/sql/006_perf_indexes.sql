-- Performance indexes for the hot foreign-key columns.
--
-- Postgres does NOT auto-index foreign keys. Without these, /photos (a
-- correlated face-count subquery per row) and /persons (group/count/first-member
-- over face_person by person_id) seq-scan the faces / face_person tables on
-- every request. Cheap to add, large win — especially over a remote DB (Neon)
-- where each seq scan is paid at network latency.

CREATE INDEX IF NOT EXISTS ix_faces_photo_id ON faces (photo_id);
CREATE INDEX IF NOT EXISTS ix_face_person_person_id ON face_person (person_id);
CREATE INDEX IF NOT EXISTS ix_photo_album_album_id ON photo_album (album_id);
