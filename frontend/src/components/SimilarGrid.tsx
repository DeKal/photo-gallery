import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getSimClusters,
  getSimClusterPhotos,
  getSimilar,
  getAlbums,
  thumbUrl,
  thumbSources,
  type Album,
  type SimCluster,
  type Photo,
  type SimilarPhoto,
} from "../api";
import { usePhotoParam } from "../useRouteState";
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
  sources,
  alt,
  onClick,
  testid,
  distance,
}: {
  sources: string[];
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
          sources={sources}
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
  routed = false,
  focus = null,
  album,
  onOpenPerson,
  onOpenSimilar,
}: {
  // URL-driven mode (top-level Similar): clusters / cluster / similar come from
  // /similar, /similar/cluster/:id, /similar/photo/:id so each is linkable. When
  // embedded in album detail (routed omitted), the drill-down stays internal.
  routed?: boolean;
  focus?: { photoId: number; n: number } | null;
  // When set, clusters/similarity are scoped to this album.
  album?: number;
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}) {
  const navigate = useNavigate();
  const params = useParams();
  const [clusters, setClusters] = useState<SimCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalView, setInternalView] = useState<View>({ kind: "clusters" });
  // Open photo mirrored to ?photo so the lightbox is part of the URL.
  const [openPhoto, setOpenPhoto] = usePhotoParam();
  // The id list + drive ids of whatever panel is on screen, lifted up so the
  // ?photo id can be mapped to a position in the lightbox.
  const [panel, setPanel] = useState<{ ids: number[]; driveIds: Record<number, string | null> }>({ ids: [], driveIds: {} });
  const [query, setQuery] = useState("");
  // Top-level Similar can be narrowed to one album; when embedded in album-detail
  // the `album` prop pins it and this picker is hidden.
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumFilter, setAlbumFilter] = useState<number | null>(null);
  const effectiveAlbum = album ?? albumFilter ?? undefined;

  // Resolve the active view from the URL (routed) or internal state (embedded).
  let view: View;
  if (routed) {
    const clusterId = params.clusterId ? Number(params.clusterId) : null;
    const photoId = params.photoId ? Number(params.photoId) : null;
    if (photoId != null) view = { kind: "similar", photoId, from: null };
    else if (clusterId != null) {
      const found = clusters.find((c) => c.id === clusterId);
      view = { kind: "cluster", cluster: found ?? { id: clusterId, label: null, cover_photo_id: null, photo_count: 0, person_names: [] } };
    } else view = { kind: "clusters" };
  } else {
    view = internalView;
  }

  const goClusters = () => (routed ? navigate("/similar") : (setOpenPhoto(null), setInternalView({ kind: "clusters" })));
  const goCluster = (c: SimCluster) => (routed ? navigate(`/similar/cluster/${c.id}`) : (setOpenPhoto(null), setInternalView({ kind: "cluster", cluster: c })));
  const goSimilar = (photoId: number, from: SimCluster | null) =>
    routed ? navigate(`/similar/photo/${photoId}`) : (setOpenPhoto(null), setInternalView({ kind: "similar", photoId, from }));

  useEffect(() => {
    if (album != null) return;
    getAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
  }, [album]);

  useEffect(() => {
    setLoading(true);
    getSimClusters(effectiveAlbum)
      .then((c) => {
        setClusters(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [effectiveAlbum]);

  // "More like this" requested from another view in embedded mode → jump to the
  // visual-similarity results for that photo (routed mode navigates via URL).
  useEffect(() => {
    if (focus && !routed) {
      setOpenPhoto(null);
      setInternalView({ kind: "similar", photoId: focus.photoId, from: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, routed]);

  // Reset the lifted panel list whenever the on-screen panel changes.
  const viewKey = view.kind === "clusters" ? "clusters" : view.kind === "cluster" ? `c${view.cluster.id}` : `s${view.photoId}`;
  useEffect(() => {
    setPanel({ ids: [], driveIds: {} });
  }, [viewKey]);

  const lbIdx = openPhoto != null ? panel.ids.indexOf(openPhoto) : -1;
  const showLb = openPhoto != null && (view.kind === "cluster" || view.kind === "similar");
  const lb = showLb ? (() => {
    const inList = lbIdx >= 0;
    const lbIds = inList ? panel.ids : [openPhoto as number];
    const lbPos = inList ? lbIdx : 0;
    return (
      <Lightbox
        ids={lbIds}
        index={lbPos}
        driveIds={panel.driveIds}
        onIndexChange={(i) => setOpenPhoto(lbIds[i] ?? null)}
        onOpenPerson={
          onOpenPerson
            ? (pid) => {
                setOpenPhoto(null);
                onOpenPerson(pid);
              }
            : undefined
        }
        onOpenSimilar={(pid) => {
          setOpenPhoto(null);
          if (onOpenSimilar) onOpenSimilar(pid);
          else goSimilar(pid, view.kind === "cluster" ? view.cluster : null);
        }}
        onClose={() => setOpenPhoto(null)}
      />
    );
  })() : null;

  if (view.kind === "cluster") {
    return (
      <section className={SECTION}>
        <ClusterPhotos
          cluster={view.cluster}
          album={effectiveAlbum}
          onBack={goClusters}
          onReady={(ids, driveIds) => setPanel({ ids, driveIds })}
          onPick={(id) => setOpenPhoto(id)}
        />
        {lb}
      </section>
    );
  }

  if (view.kind === "similar") {
    return (
      <section className={SECTION}>
        <SimilarPanel
          photoId={view.photoId}
          album={effectiveAlbum}
          onBack={() => (view.kind === "similar" && view.from ? goCluster(view.from) : goClusters())}
          onReady={(ids, driveIds) => setPanel({ ids, driveIds })}
          onPick={(id) => setOpenPhoto(id)}
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
        <div className="flex items-center gap-space-sm">
          {album == null && (
            <div className="relative">
              <Icon name="collections_bookmark" className="text-[16px] text-outline absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                data-testid="sim-album-filter"
                value={albumFilter ?? ""}
                onChange={(e) => setAlbumFilter(e.target.value ? Number(e.target.value) : null)}
                className="h-11 pl-9 pr-8 appearance-none rounded-xl bg-surface-container border border-outline-variant/60 text-on-surface text-body-sm font-body-sm hover:border-outline-variant focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
              >
                <option value="">All albums</option>
                {albums.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <Icon name="expand_more" className="text-[16px] text-outline absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
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
              onClick={() => goCluster(c)}
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
  album,
  onBack,
  onReady,
  onPick,
}: {
  cluster: SimCluster;
  album?: number;
  onBack: () => void;
  onReady: (ids: number[], driveIds: Record<number, string | null>) => void;
  onPick: (id: number) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimClusterPhotos(cluster.id, album)
      .then((p) => {
        setPhotos(p);
        onReady(
          p.map((x) => x.id),
          Object.fromEntries(p.map((x) => [x.id, x.drive_file_id ?? null])),
        );
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id, album]);

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
        {photos.map((photo) => (
          <PhotoTile
            key={photo.id}
            testid="cluster-photo"
            sources={thumbSources(photo.id, photo.drive_file_id)}
            alt={photo.path}
            onClick={() => onPick(photo.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SimilarPanel({
  photoId,
  album,
  onBack,
  onReady,
  onPick,
}: {
  photoId: number;
  album?: number;
  onBack: () => void;
  onReady: (ids: number[], driveIds: Record<number, string | null>) => void;
  onPick: (id: number) => void;
}) {
  const [results, setResults] = useState<SimilarPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimilar(photoId, 50, album)
      .then((r) => {
        const sorted = [...r].sort((a, b) => a.distance - b.distance);
        setResults(sorted);
        onReady(
          sorted.map((x) => x.photo_id),
          Object.fromEntries(sorted.map((x) => [x.photo_id, x.drive_file_id ?? null])),
        );
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId, album]);

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
          {results.map((r) => (
            <PhotoTile
              key={r.photo_id}
              sources={thumbSources(r.photo_id, r.drive_file_id)}
              alt={`Photo ${r.photo_id}`}
              distance={r.distance}
              onClick={() => onPick(r.photo_id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
