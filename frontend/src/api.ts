// Typed REST client for the photo-clustering backend.
//
// The backend runs natively on the host at http://localhost:8000 and its CORS
// config already allows http://localhost:5173 (the Vite dev server), so we call
// it directly. Override with VITE_API_BASE at build/dev time if needed.
export const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

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
}

export interface Photo {
  id: number;
  path: string;
  thumb_path: string | null;
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

export function getPersons(): Promise<Person[]> {
  return request("/persons");
}

export function getPersonPhotos(id: number): Promise<Photo[]> {
  return request(`/persons/${id}/photos`);
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
