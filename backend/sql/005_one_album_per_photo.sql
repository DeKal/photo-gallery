-- One album per photo: dedupe existing memberships (keep the most recently
-- created album for each photo), then enforce it with a unique constraint.
DELETE FROM photo_album pa
USING photo_album keep
WHERE pa.photo_id = keep.photo_id
  AND pa.album_id < keep.album_id;

ALTER TABLE photo_album ADD CONSTRAINT photo_album_photo_unique UNIQUE (photo_id);
