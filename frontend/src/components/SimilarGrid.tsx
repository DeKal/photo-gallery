import { useEffect, useState } from "react";
import {
  getSimClusters,
  getSimClusterPhotos,
  getSimilar,
  thumbUrl,
  imageUrl,
  type SimCluster,
  type Photo,
  type SimilarPhoto,
} from "../api";
import ImgWithFallback from "./ImgWithFallback";
import Lightbox from "./Lightbox";

const photoPlaceholder = (
  <div className="thumb thumb-placeholder" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

type View =
  | { kind: "clusters" }
  | { kind: "cluster"; cluster: SimCluster }
  | { kind: "similar"; photoId: number; from: SimCluster | null };

export default function SimilarGrid() {
  const [clusters, setClusters] = useState<SimCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "clusters" });
  // Full-resolution photo currently open in the lightbox (shared by all views).
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimClusters()
      .then((c) => {
        setClusters(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const lb =
    lightbox != null ? (
      <Lightbox
        src={imageUrl(lightbox)}
        alt={`Photo ${lightbox}`}
        actionLabel="More like this"
        onAction={() => {
          const from = view.kind === "cluster" ? view.cluster : null;
          setView({ kind: "similar", photoId: lightbox, from });
          setLightbox(null);
        }}
        onClose={() => setLightbox(null)}
      />
    ) : null;

  if (view.kind === "cluster") {
    return (
      <>
        <ClusterPhotos
          cluster={view.cluster}
          onBack={() => setView({ kind: "clusters" })}
          onOpen={setLightbox}
        />
        {lb}
      </>
    );
  }

  if (view.kind === "similar") {
    return (
      <>
        <SimilarPanel
          photoId={view.photoId}
          onBack={() =>
            view.from
              ? setView({ kind: "cluster", cluster: view.from })
              : setView({ kind: "clusters" })
          }
          onOpen={setLightbox}
        />
        {lb}
      </>
    );
  }

  return (
    <div>
      {error && <div className="error-text">{error}</div>}
      {loading && <div className="loading">Loading clusters…</div>}
      {!loading && clusters.length === 0 && (
        <div className="empty">
          No similarity clusters yet. Scan a folder to get started.
        </div>
      )}
      <div className="grid">
        {clusters.map((c) => (
          <div
            key={c.id}
            className="card"
            data-testid="sim-cluster-card"
            onClick={() => setView({ kind: "cluster", cluster: c })}
          >
            {c.cover_photo_id != null ? (
              <ImgWithFallback
                className="thumb"
                sources={[thumbUrl(c.cover_photo_id)]}
                alt={c.label ?? `Cluster ${c.id}`}
                placeholder={photoPlaceholder}
              />
            ) : (
              photoPlaceholder
            )}
            <div className="card-body">
              <div className="card-title">{c.label ?? `Cluster ${c.id}`}</div>
              <div className="card-sub">
                {c.photo_count} {c.photo_count === 1 ? "photo" : "photos"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClusterPhotos({
  cluster,
  onBack,
  onOpen,
}: {
  cluster: SimCluster;
  onBack: () => void;
  onOpen: (photoId: number) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimClusterPhotos(cluster.id)
      .then((p) => {
        setPhotos(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [cluster.id]);

  return (
    <div>
      <div className="detail-header">
        <button onClick={onBack}>← Back</button>
        <h2>{cluster.label ?? `Cluster ${cluster.id}`}</h2>
        <span className="hint">Click a photo to view it</span>
      </div>
      {error && <div className="error-text">{error}</div>}
      {loading && <div className="loading">Loading photos…</div>}
      <div className="grid">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="photo-tile"
            data-testid="cluster-photo"
            onClick={() => onOpen(photo.id)}
          >
            <ImgWithFallback
              className="thumb"
              sources={[thumbUrl(photo.id)]}
              alt={photo.path}
              placeholder={photoPlaceholder}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SimilarPanel({
  photoId,
  onBack,
  onOpen,
}: {
  photoId: number;
  onBack: () => void;
  onOpen: (photoId: number) => void;
}) {
  const [results, setResults] = useState<SimilarPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimilar(photoId, 50)
      .then((r) => {
        // Nearest first (smallest cosine distance).
        setResults([...r].sort((a, b) => a.distance - b.distance));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [photoId]);

  return (
    <div>
      <div className="detail-header">
        <button onClick={onBack}>← Back</button>
        <h2>More like this</h2>
        <span className="hint">Click a photo to view it</span>
      </div>

      <div className="more-like-this" data-testid="more-like-this">
        {error && <div className="error-text">{error}</div>}
        {loading && <div className="loading">Finding similar photos…</div>}
        {!loading && results.length === 0 && (
          <div className="empty">No similar photos found.</div>
        )}
        <div className="grid">
          {results.map((r) => (
            <div
              key={r.photo_id}
              className="photo-tile"
              onClick={() => onOpen(r.photo_id)}
            >
              <ImgWithFallback
                className="thumb"
                sources={[thumbUrl(r.photo_id)]}
                alt={`Photo ${r.photo_id}`}
                placeholder={photoPlaceholder}
              />
              <span className="distance">{r.distance.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
