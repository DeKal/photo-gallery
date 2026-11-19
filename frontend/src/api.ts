// Typed REST client for the photo-clustering backend.
//
// In production the app is served behind an nginx gateway that proxies every
// backend path to the right service (ML/media -> native worker, the rest -> the
// api container), so BASE defaults to "" (same origin). For the direct-dev
// workflow (Vite on :5173, backends on their own ports) set VITE_API_BASE —
// e.g. http://localhost:8000 for the combined app.
export const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

// ---- Types ---------------------------------------------------------------

export type ScanStatus = "pending" | "running" | "downloading" | "completed" | "failed";

export interface Scan {
  id: number;
  root_path: string;
  status: ScanStatus;
  done: number;
  total: number;
}

export interface ClusterResult {
  faces: Record<string, unknown>;
  images: Record<string, unknown>;
}

export interface Person {
  id: number;
  name: string | null;
  cover_face_id: number | null;
  cover_photo_id: number | null;
  face_count: number;
  hidden: boolean;
}

export interface Photo {
  id: number;
  path: string;
  thumb_path: string | null;
  drive_file_id?: string | null;
}

export interface Face {
  id: number;
  photo_id: number;
  det_score: number;
  thumb_path: string | null;
  is_cover: boolean;
}

export interface SimCluster {
  id: number;
  label: string | null;
  cover_photo_id: number | null;
  photo_count: number;
  person_names: string[];
}

export interface SimilarPhoto {
  photo_id: number;
  distance: number;
  thumb_path: string | null;
  drive_file_id?: string | null;
}

export interface FaceMoveResult {
  moved: number;
  person_id: number | null;
}

// ---- Low-level helpers ---------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  // Some endpoints may return empty bodies.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- Media URL helpers ---------------------------------------------------

export function thumbUrl(photoId: number): string {
  return `${BASE}/thumb/${photoId}`;
}

export function faceThumbUrl(faceId: number): string {
  return `${BASE}/face-thumb/${faceId}`;
}

export function imageUrl(photoId: number): string {
  return `${BASE}/image/${photoId}`;
}

// ---- Google Drive media URLs --------------------------------------------
// Photos ingested from a Drive folder carry a drive_file_id; we display them
// straight from Drive (and fall back to the local copy if that fails). These
// are the two content endpoints that actually render inside an <img>: the
// normal share link (drive.google.com/file/d/ID/view) is an HTML page and will
// not embed.

export function driveThumbUrl(fileId: string, size = 1000): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

export function driveImageUrl(fileId: string, size = 2000): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`;
}

// Candidate sources for ImgWithFallback / the lightbox: Drive first (when the
// photo has a drive_file_id), local copy as the fallback. Order matters — the
// first that loads wins, so a Drive hiccup degrades to the local image.
export function thumbSources(
  photoId: number,
  driveFileId?: string | null,
): string[] {
  return driveFileId
    ? [driveThumbUrl(driveFileId), thumbUrl(photoId)]
    : [thumbUrl(photoId)];
}

export function imageSources(
  photoId: number,
  driveFileId?: string | null,
): string[] {
  return driveFileId
    ? [driveImageUrl(driveFileId), imageUrl(photoId)]
    : [imageUrl(photoId)];
}

// Download the full-resolution photo to the user's disk. Tries each candidate
// source in turn, fetching the bytes and saving them via a temporary <a>. Drive
// (lh3.googleusercontent.com) may block cross-origin fetches with CORS; if every
// source fails we open the first URL in a new tab so the user can save it
// manually.
export async function downloadPhoto(
  photoId: number,
  driveFileId?: string | null,
): Promise<void> {
  const srcs = imageSources(photoId, driveFileId);
  for (const src of srcs) {
    try {
      const res = await fetch(src, { referrerPolicy: "no-referrer" });
      if (!res.ok) continue;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `photo-${photoId}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    } catch {
      // Try the next source.
    }
  }
  window.open(srcs[0], "_blank", "noopener");
}

// ---- Scan ----------------------------------------------------------------

export function startScan(rootPath: string, albumName?: string): Promise<{ scan_id: number }> {
  return request("/scan", {
    method: "POST",
    body: JSON.stringify({
      root_path: rootPath,
      ...(albumName && albumName.trim() ? { album_name: albumName.trim() } : {}),
    }),
  });
}

export function getScan(id: number): Promise<Scan> {
  return request(`/scan/${id}`);
}

export function pickFolder(): Promise<{ path: string | null }> {
  return request("/pick-folder");
}

export function cluster(): Promise<ClusterResult> {
  return request("/cluster", { method: "POST" });
}

// ---- Persons -------------------------------------------------------------

// Persons, similarity and their photos/faces can be scoped to a single album
// (the album-detail view). Omit the album arg for the global library views.
export interface PersonListPage {
  total: number;
  items: Person[];
}

// Paginated like getPhotos: the UI loads people in pages (limit/offset) and
// filters by name server-side, rather than fetching every cluster at once.
export function getPersons(
  opts: {
    includeHidden?: boolean;
    hiddenOnly?: boolean;
    album?: number;
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<PersonListPage> {
  const qs = new URLSearchParams();
  if (opts.includeHidden) qs.set("include_hidden", "true");
  if (opts.hiddenOnly) qs.set("hidden_only", "true");
  if (opts.album != null) qs.set("album", String(opts.album));
  if (opts.q && opts.q.trim()) qs.set("q", opts.q.trim());
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  if (opts.offset != null) qs.set("offset", String(opts.offset));
  const s = qs.toString();
  return request(`/persons${s ? `?${s}` : ""}`);
}

export function hidePerson(id: number): Promise<Person> {
  return request(`/persons/${id}/hide`, { method: "POST" });
}

export function unhidePerson(id: number): Promise<Person> {
  return request(`/persons/${id}/unhide`, { method: "POST" });
}

export function getPerson(id: number, album?: number): Promise<Person> {
  return request(`/persons/${id}${album != null ? `?album=${album}` : ""}`);
}

export function getPersonPhotos(id: number, album?: number): Promise<Photo[]> {
  return request(`/persons/${id}/photos${album != null ? `?album=${album}` : ""}`);
}

export function getPersonFaces(id: number, album?: number): Promise<Face[]> {
  return request(`/persons/${id}/faces${album != null ? `?album=${album}` : ""}`);
}

// Download a single face crop (the person's current cover face) to disk.
// The crop is served same-origin via the gateway, so the fetch→blob save works.
export async function downloadFaceCrop(
  faceId: number,
  name?: string | null,
): Promise<void> {
  const src = faceThumbUrl(faceId);
  const safe = (name || `face-${faceId}`).replace(/[^a-zA-Z0-9-_]/g, "_");
  try {
    const res = await fetch(src, { referrerPolicy: "no-referrer" });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safe}-face.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }
  } catch {
    // Fall through to opening the crop in a new tab.
  }
  window.open(src, "_blank", "noopener");
}

export function setPersonCover(id: number, faceId: number): Promise<Person> {
  return request(`/persons/${id}/cover`, {
    method: "POST",
    body: JSON.stringify({ face_id: faceId }),
  });
}

export function renamePerson(id: number, name: string): Promise<Person> {
  return request(`/persons/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function mergePersons(ids: number[]): Promise<Person> {
  return request("/persons/merge", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function moveFaces(
  faceIds: number[],
  personId: number | null,
): Promise<FaceMoveResult> {
  return request("/faces/move", {
    method: "POST",
    body: JSON.stringify({ face_ids: faceIds, person_id: personId }),
  });
}

// ---- Similarity ----------------------------------------------------------

export function getSimClusters(album?: number): Promise<SimCluster[]> {
  return request(`/sim-clusters${album != null ? `?album=${album}` : ""}`);
}

export function getSimClusterPhotos(id: number, album?: number): Promise<Photo[]> {
  return request(`/sim-clusters/${id}/photos${album != null ? `?album=${album}` : ""}`);
}

export function getSimilar(photoId: number, k = 50, album?: number): Promise<SimilarPhoto[]> {
  const al = album != null ? `&album=${album}` : "";
  return request(`/photos/${photoId}/similar?k=${k}${al}`);
}

// ---- All Photos (flat library) ------------------------------------------

export interface PhotoPerson {
  id: number;
  name: string | null;
}

export interface PhotoListItem {
  id: number;
  path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  drive_file_id?: string | null;
  face_count: number;
  person_count: number;
  persons: PhotoPerson[];
  favorite?: boolean;
}

export interface PhotoListPage {
  total: number;
  items: PhotoListItem[];
}

export type PhotoOrder = "newest" | "oldest";

export function getPhotoPersons(photoId: number): Promise<PhotoPerson[]> {
  return request(`/photos/${photoId}/persons`);
}

// Favorite (star) state of a single photo, and a setter. The lightbox fetches
// the state when a photo opens and toggles it with the star button.
export function getPhotoFavorite(photoId: number): Promise<{ id: number; favorite: boolean }> {
  return request(`/photos/${photoId}/favorite`);
}

export function setPhotoFavorite(
  photoId: number,
  favorite: boolean,
): Promise<{ id: number; favorite: boolean }> {
  return request(`/photos/${photoId}/favorite`, {
    method: "PUT",
    body: JSON.stringify({ favorite }),
  });
}

export function getPhotos(
  limit = 120,
  offset = 0,
  order: PhotoOrder = "newest",
  q = "",
  album?: number,
  favorites = false,
): Promise<PhotoListPage> {
  const qs = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
  const al = album != null ? `&album=${album}` : "";
  const fav = favorites ? `&favorites=true` : "";
  return request(`/photos?limit=${limit}&offset=${offset}&order=${order}${qs}${al}${fav}`);
}

// ---- Albums --------------------------------------------------------------

export interface Album {
  id: number;
  name: string;
  photo_count: number;
  cover_photo_id: number | null;
  cover_drive_file_id?: string | null;
}

export function getAlbums(): Promise<Album[]> {
  return request("/albums");
}

// Albums a single photo currently belongs to (for membership toggles).
export function getPhotoAlbums(photoId: number): Promise<Album[]> {
  return request(`/photos/${photoId}/albums`);
}

export function createAlbum(name: string): Promise<Album> {
  return request("/albums", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameAlbum(id: number, name: string): Promise<Album> {
  return request(`/albums/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteAlbum(id: number): Promise<{ deleted: boolean }> {
  return request(`/albums/${id}`, { method: "DELETE" });
}

export function addPhotosToAlbum(id: number, photoIds: number[]): Promise<Album> {
  return request(`/albums/${id}/photos`, {
    method: "POST",
    body: JSON.stringify({ photo_ids: photoIds }),
  });
}

export function removePhotosFromAlbum(id: number, photoIds: number[]): Promise<Album> {
  return request(`/albums/${id}/photos`, {
    method: "DELETE",
    body: JSON.stringify({ photo_ids: photoIds }),
  });
}

// Set the album cover. Pass a photoId to use that exact (member) photo, or null
// to let the server pick a random member.
export function setAlbumCover(id: number, photoId: number | null): Promise<Album> {
  return request(`/albums/${id}/cover`, {
    method: "PUT",
    body: JSON.stringify({ photo_id: photoId }),
  });
}
