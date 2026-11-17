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

export type ScanStatus = "pending" | "running" | "completed" | "failed";

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
}

export interface SimilarPhoto {
  photo_id: number;
  distance: number;
  thumb_path: string | null;
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

// ---- Scan ----------------------------------------------------------------

export function startScan(rootPath: string): Promise<{ scan_id: number }> {
  return request("/scan", {
    method: "POST",
    body: JSON.stringify({ root_path: rootPath }),
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

export function getPersons(includeHidden = false): Promise<Person[]> {
  return request(`/persons${includeHidden ? "?include_hidden=true" : ""}`);
}

export function hidePerson(id: number): Promise<Person> {
  return request(`/persons/${id}/hide`, { method: "POST" });
}

export function unhidePerson(id: number): Promise<Person> {
  return request(`/persons/${id}/unhide`, { method: "POST" });
}

export function getPerson(id: number): Promise<Person> {
  return request(`/persons/${id}`);
}

export function getPersonPhotos(id: number): Promise<Photo[]> {
  return request(`/persons/${id}/photos`);
}

export function getPersonFaces(id: number): Promise<Face[]> {
  return request(`/persons/${id}/faces`);
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

export function getSimClusters(): Promise<SimCluster[]> {
  return request("/sim-clusters");
}

export function getSimClusterPhotos(id: number): Promise<Photo[]> {
  return request(`/sim-clusters/${id}/photos`);
}

export function getSimilar(photoId: number, k = 50): Promise<SimilarPhoto[]> {
  return request(`/photos/${photoId}/similar?k=${k}`);
}

// ---- All Photos (flat library) ------------------------------------------

export interface PhotoListItem {
  id: number;
  path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
}

export interface PhotoListPage {
  total: number;
  items: PhotoListItem[];
}

export type PhotoOrder = "newest" | "oldest";

export function getPhotos(
  limit = 120,
  offset = 0,
  order: PhotoOrder = "newest",
): Promise<PhotoListPage> {
  return request(`/photos?limit=${limit}&offset=${offset}&order=${order}`);
}
