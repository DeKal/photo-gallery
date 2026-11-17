import { useEffect, useState } from "react";
import {
  getSimClusters,
  getSimClusterPhotos,
  getSimilar,
  thumbUrl,
  type SimCluster,
  type Photo,
  type SimilarPhoto,
} from "../api";
import ImgWithFallback from "./ImgWithFallback";
import Lightbox from "./Lightbox";
import Icon from "./Icon";

const photoPlaceholder = (
  <div
    className="w-full h-full flex items-center justify-center bg-gradient-to-b from-surface-container to-surface text-outline-variant"
    aria-hidden="true"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[34%] h-[34%]">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

const SECTION = "px-margin-md lg:px-margin-lg py-space-md pb-32 flex-1";

function BackHeader({ onBack, title, hint }: { onBack: () => void; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-space-md mb-space-lg flex-wrap">
      <button
        onClick={onBack}
        className="px-space-md py-1.5 rounded-xl bg-surface-container border border-outline-variant hover:border-outline text-on-surface text-label-md font-label-md flex items-center gap-1.5 hover:bg-surface-container-high transition-colors"
      >
        <Icon name="arrow_back" className="text-base" />
        Back
      </button>
      <h2 className="text-headline-md font-headline-md text-on-surface">{title}</h2>
      {hint && <span className="text-body-sm font-body-sm text-outline">{hint}</span>}
    </div>
  );
}

function PhotoTile({
  src,
  alt,
  onClick,
  testid,
  distance,
}: {
  src: string;
  alt: string;
  onClick: () => void;
  testid?: string;
  distance?: number;
}) {
  return (
    <div
      data-testid={testid}
      onClick={onClick}
      className="group relative rounded-2xl overflow-hidden cursor-pointer bg-surface-container border border-outline-variant hover:border-primary/60 hover:shadow-lg transition-all duration-300"
    >
      <div className="aspect-square w-full overflow-hidden">
        <ImgWithFallback
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          sources={[src]}
          alt={alt}
          placeholder={photoPlaceholder}
        />
      </div>
      {distance != null && (
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-full bg-surface-container-lowest/80 backdrop-blur-sm text-tertiary text-label-sm font-label-sm">
          {distance.toFixed(3)}
        </span>
      )}
    </div>
  );
}

type View =
  | { kind: "clusters" }
  | { kind: "cluster"; cluster: SimCluster }
  | { kind: "similar"; photoId: number; from: SimCluster | null };

export default function SimilarGrid({
  focus = null,
  onOpenPerson,
  onOpenSimilar,
}: {
  focus?: { photoId: number; n: number } | null;
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}) {
  const [clusters, setClusters] = useState<SimCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "clusters" });
  const [lightbox, setLightbox] = useState<{ ids: number[]; index: number } | null>(null);
  const [query, setQuery] = useState("");

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

  // "More like this" requested from another view → jump straight to the
  // visual-similarity results for that photo.
  useEffect(() => {
    if (focus) {
      setLightbox(null);
      setView({ kind: "similar", photoId: focus.photoId, from: null });
    }
  }, [focus]);

  const lb =
    lightbox != null ? (
      <Lightbox
        ids={lightbox.ids}
        index={lightbox.index}
        onIndexChange={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))}
        onOpenPerson={
          onOpenPerson
            ? (pid) => {
                setLightbox(null);
                onOpenPerson(pid);
              }
            : undefined
        }
        onOpenSimilar={(pid) => {
          setLightbox(null);
          if (onOpenSimilar) onOpenSimilar(pid);
          else setView({ kind: "similar", photoId: pid, from: view.kind === "cluster" ? view.cluster : null });
        }}
        onClose={() => setLightbox(null)}
      />
    ) : null;

  if (view.kind === "cluster") {
    return (
      <section className={SECTION}>
        <ClusterPhotos cluster={view.cluster} onBack={() => setView({ kind: "clusters" })} onOpen={(ids, index) => setLightbox({ ids, index })} />
        {lb}
      </section>
    );
  }

  if (view.kind === "similar") {
    return (
      <section className={SECTION}>
        <SimilarPanel
          photoId={view.photoId}
          onBack={() => (view.from ? setView({ kind: "cluster", cluster: view.from }) : setView({ kind: "clusters" }))}
          onOpen={(ids, index) => setLightbox({ ids, index })}
        />
        {lb}
      </section>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? clusters.filter(
        (c) =>
          (c.label ?? "").toLowerCase().includes(q) ||
          c.person_names.some((n) => n.toLowerCase().includes(q))
      )
    : clusters;

  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-space-md mb-space-lg flex-wrap">
        <span className="font-body-md text-body-md text-on-surface-variant font-medium">
          {q ? `${visible.length} of ${clusters.length}` : clusters.length} similar {clusters.length === 1 ? "set" : "sets"}
        </span>
        <div className="flex items-center bg-surface-container border border-outline-variant/60 rounded-xl px-3 h-11 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <Icon name="search" className="text-outline text-base mr-1.5" />
          <input
            type="text"
            data-testid="sim-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter sets by person name…"
            className="w-44 sm:w-56 bg-transparent text-on-surface text-body-sm font-body-sm outline-none border-none p-0 focus:ring-0 placeholder:text-outline"
          />
          {query && (
            <button className="ml-1 text-outline hover:text-on-surface" title="Clear filter" onClick={() => setQuery("")}>
              <Icon name="close" className="text-sm" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
          <Icon name="error" className="text-base" />
          {error}
        </div>
      )}
      {loading && <div className="text-outline py-12 text-center">Loading clusters…</div>}
      {!loading && clusters.length === 0 && (
        <div className="text-outline py-12 text-center">No similarity clusters yet. Scan a folder to get started.</div>
      )}
      {!loading && clusters.length > 0 && visible.length === 0 && (
        <div className="text-outline py-12 text-center">No sets contain a person matching “{query}”.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-gutter-lg">
        {visible.map((c) => {
          const label = c.label ?? `Cluster ${c.id}`;
          const unlabeled = !c.label;
          return (
            <div
              key={c.id}
              data-testid="sim-cluster-card"
              onClick={() => setView({ kind: "cluster", cluster: c })}
              className={`group relative rounded-2xl bg-surface-container overflow-hidden shadow-lg cursor-pointer transition-all duration-300 hover:scale-[1.015] hover:shadow-primary/10 border ${
                unlabeled ? "border-dashed border-outline hover:border-primary" : "border-outline-variant hover:border-primary/40"
              }`}
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-container-lowest">
                {c.cover_photo_id != null ? (
                  <ImgWithFallback
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    sources={[thumbUrl(c.cover_photo_id)]}
                    alt={label}
                    placeholder={photoPlaceholder}
                  />
                ) : (
                  photoPlaceholder
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/20 to-transparent opacity-95" />

                {/* Stack count badge */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-lowest/80 backdrop-blur-md border border-white/10 text-white font-label-sm text-label-sm shadow-md">
                  <Icon name="photo_library" className="text-[14px]" />
                  <span>{c.photo_count}</span>
                </div>

                {/* Bottom overlay */}
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                  <div className="min-w-0">
                    {unlabeled ? (
                      <div className="flex items-center gap-1.5 text-primary">
                        <h3 className="font-headline-sm text-headline-sm font-medium tracking-tight truncate">{label}</h3>
                        <Icon name="edit" className="text-[16px]" />
                      </div>
                    ) : (
                      <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface tracking-tight truncate group-hover:text-primary transition-colors">
                        {label}
                      </h3>
                    )}
                    <p className="font-body-sm text-body-sm text-outline mt-0.5">
                      {c.photo_count} {c.photo_count === 1 ? "photo" : "photos"}
                    </p>
                  </div>
                  <span className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-surface-container-high/90 text-on-surface transition-all" title="Inspect set">
                    <Icon name="zoom_in" className="text-[18px]" />
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ClusterPhotos({
  cluster,
  onBack,
  onOpen,
}: {
  cluster: SimCluster;
  onBack: () => void;
  onOpen: (ids: number[], index: number) => void;
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
      <BackHeader onBack={onBack} title={cluster.label ?? `Cluster ${cluster.id}`} hint={`${photos.length} photos · click any photo to view`} />
      {error && (
        <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
          <Icon name="error" className="text-base" />
          {error}
        </div>
      )}
      {loading && <div className="text-outline py-12 text-center">Loading photos…</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {photos.map((photo, i) => (
          <PhotoTile key={photo.id} testid="cluster-photo" src={thumbUrl(photo.id)} alt={photo.path} onClick={() => onOpen(photos.map((p) => p.id), i)} />
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
  onOpen: (ids: number[], index: number) => void;
}) {
  const [results, setResults] = useState<SimilarPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimilar(photoId, 50)
      .then((r) => {
        setResults([...r].sort((a, b) => a.distance - b.distance));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [photoId]);

  return (
    <div>
      <BackHeader onBack={onBack} title="More like this" hint="nearest matches first" />
      <div data-testid="more-like-this">
        {error && (
          <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
            <Icon name="error" className="text-base" />
            {error}
          </div>
        )}
        {loading && <div className="text-outline py-12 text-center">Finding similar photos…</div>}
        {!loading && results.length === 0 && <div className="text-outline py-12 text-center">No similar photos found.</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {results.map((r, i) => (
            <PhotoTile key={r.photo_id} src={thumbUrl(r.photo_id)} alt={`Photo ${r.photo_id}`} distance={r.distance} onClick={() => onOpen(results.map((x) => x.photo_id), i)} />
          ))}
        </div>
      </div>
    </div>
  );
}
