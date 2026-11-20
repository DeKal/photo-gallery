// Central permission map, mirroring backend `app/permissions.py`. One source of
// truth for which capabilities require a signed-in admin. Flip a value to
// `false` to open that capability (its UI control shows for everyone and the
// backend lets anonymous calls through). Keep the two files in sync.
export const REQUIRES_ADMIN = {
  // Worker functions
  scan: true,
  cluster: true,
  pickFolder: true,
  // People curation
  personHide: true,
  personShowHidden: true,
  personRename: true,
  personMerge: true,
  personCover: false, // cover face is a safe, display-only pick
  faceMove: true,
  // Albums
  albumCreate: true,
  albumRename: true,
  albumDelete: true,
  albumAddPhoto: true,
  albumRemovePhoto: true,
  albumCover: true,
  // Photos
  photoFavorite: false, // starring a photo is a safe, shared toggle
} as const;

export type Capability = keyof typeof REQUIRES_ADMIN;
