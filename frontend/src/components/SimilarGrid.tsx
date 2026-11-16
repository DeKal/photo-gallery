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

type View =
  | { kind: "clusters" }
  | { kind: "cluster"; cluster: SimCluster }
  | { kind: "similar"; photoId: number; from: SimCluster | null };

export default function SimilarGrid() {
  const [clusters, setClusters] = useState<SimCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "clusters" });

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

  if (view.kind === "cluster") {
    return (
      <ClusterPhotos
        cluster={view.cluster}
        onBack={() => setView({ kind: "clusters" })}
        onPhoto={(photoId) =>
          setView({ kind: "similar", photoId, from: view.cluster })
        }
      />
    );
  }

  if (view.kind === "similar") {
    return (
      <SimilarPanel
        photoId={view.photoId}
        onBack={() =>
          view.from
            ? setView({ kind: "cluster", cluster: view.from })
            : setView({ kind: "clusters" })
        }
        onPhoto={(photoId) =>
          setView({ kind: "similar", photoId, from: view.from })
        }
      />
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
            onClick={() => setView({ kind: "cluster", cluster: c })}
          >
            {c.cover_photo_id != null ? (
              <img
                className="thumb"
                src={thumbUrl(c.cover_photo_id)}
                alt={c.label ?? `Cluster ${c.id}`}
                loading="lazy"
              />
            ) : (
              <div className="thumb" />
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
  onPhoto,
}: {
  cluster: SimCluster;
  onBack: () => void;
  onPhoto: (photoId: number) => void;
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
        <span className="hint">Click a photo to find more like it</span>
      </div>
      {error && <div className="error-text">{error}</div>}
      {loading && <div className="loading">Loading photos…</div>}
      <div className="grid">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="photo-tile"
            onClick={() => onPhoto(photo.id)}
          >
            <img
              className="thumb"
              src={thumbUrl(photo.id)}
              alt={photo.path}
              loading="lazy"
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
  onPhoto,
}: {
  photoId: number;
  onBack: () => void;
  onPhoto: (photoId: number) => void;
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
      </div>

      <div className="hero">
        <img src={imageUrl(photoId)} alt={`Photo ${photoId}`} />
      </div>

      <div className="more-like-this">
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
              onClick={() => onPhoto(r.photo_id)}
            >
              <img
                className="thumb"
                src={thumbUrl(r.photo_id)}
                alt={`Photo ${r.photo_id}`}
                loading="lazy"
              />
              <span className="distance">{r.distance.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
