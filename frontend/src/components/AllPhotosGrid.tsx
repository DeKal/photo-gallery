import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPhotos, getAlbums, removePhotosFromAlbum, setAlbumCover, thumbSources, type Album, type PhotoListItem, type PhotoOrder } from "../api";
import { usePhotoParam } from "../useRouteState";
import ImgWithFallback from "./ImgWithFallback";
import Lightbox from "./Lightbox";
import Icon from "./Icon";

const PAGE = 120;

const photoPlaceholder = (
  <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-surface-container to-surface text-outline-variant" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[30%] h-[30%]">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function monthLabel(takenAt: string | null): string {
  if (!takenAt) return "Undated";
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return "Undated";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function AllPhotosGrid({
  onOpenPerson,
  onOpenSimilar,
  album,
  onBack,
  onAlbumChanged,
  embedded = false,
}: {
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
  // When set, the grid shows only this album's photos, with a back button and a
  // per-photo remove-from-album action. `coverPhotoId` marks the current cover.
  album?: { id: number; name: string; coverPhotoId?: number | null };
  onBack?: () => void;
  // Fired after the album's cover changes, so the parent can refresh its card.
  onAlbumChanged?: () => void;
  // When embedded in the album-detail tabs, the owning view already renders the
  // Back button + album title, so the grid drops its own (keeps count + search).
  embedded?: boolean;
}) {
  const [items, setItems] = useState<PhotoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [order, setOrder] = useState<PhotoOrder>("newest");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The open photo lives in the `?photo=<id>` query so it's part of the URL.
  const [openPhoto, setOpenPhoto] = usePhotoParam();
  // In the global library view, let the user narrow to a single album. When the
  // grid is already pinned to an album (album-detail), this picker is hidden and
  // the pinned album wins.
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumFilter, setAlbumFilter] = useState<number | null>(null);
  // Narrow the grid to starred photos only.
  const [favorites, setFavorites] = useState(false);

  const albumId = album?.id ?? albumFilter ?? undefined;
  const loadPage = useCallback((offset: number, ord: PhotoOrder, q: string, replace: boolean) => {
    setLoading(true);
    getPhotos(PAGE, offset, ord, q, albumId, favorites)
      .then((page) => {
        setTotal(page.total);
        setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [albumId, favorites]);

  // Album options for the library-view filter (not needed when album-pinned).
  useEffect(() => {
    if (album) return;
    getAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
  }, [album]);

  const removeFromAlbum = async (photoId: number) => {
    if (albumId == null) return;
    try {
      await removePhotosFromAlbum(albumId, [photoId]);
      setItems((prev) => prev.filter((p) => p.id !== photoId));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Which member photo is the album cover (highlighted star). Seeded from the
  // album prop, updated optimistically when the user picks a new one.
  const [coverId, setCoverId] = useState<number | null | undefined>(album?.coverPhotoId);
  const setCover = async (photoId: number) => {
    if (!album) return;
    try {
      await setAlbumCover(album.id, photoId);
      setCoverId(photoId);
      onAlbumChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Debounce the search box so each keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setItems([]);
    loadPage(0, order, debounced, true);
  }, [order, debounced, loadPage]);

  const groups = useMemo(() => {
    const out: { label: string; photos: PhotoListItem[] }[] = [];
    for (const p of items) {
      const label = monthLabel(p.taken_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.photos.push(p);
      else out.push({ label, photos: [p] });
    }
    return out;
  }, [items]);

  const hasMore = items.length < total;
  const ids = items.map((p) => p.id);

  // Infinite scroll: when a sentinel below the grid scrolls into view, fetch the
  // next page. The manual "Load more" button stays as a fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadPage(items.length, order, debounced, false);
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, items.length, order, debounced, loadPage]);
  // Per-id Drive file id so the lightbox can show the Drive image (fallback: local).
  const driveIds = useMemo(() => {
    const m: Record<number, string | null> = {};
    for (const p of items) m[p.id] = p.drive_file_id ?? null;
    return m;
  }, [items]);

  return (
    <section className="flex flex-col flex-1">
      {/* Toolbar row */}
      <div className="px-margin-md lg:px-margin-lg pt-space-lg pb-space-md border-b border-outline-variant/40 flex flex-wrap items-center justify-between gap-space-md bg-surface/50 backdrop-blur-sm">
        <div className="flex items-center gap-space-md">
          {!embedded && album && onBack && (
            <button
              onClick={onBack}
              className="px-space-md py-1.5 rounded-xl bg-surface-container border border-outline-variant hover:border-outline text-on-surface text-label-md font-label-md flex items-center gap-1.5 hover:bg-surface-container-high transition-colors"
            >
              <Icon name="arrow_back" className="text-base" />
              Back
            </button>
          )}
          {!embedded && (
            <h1 className="text-headline-sm md:text-headline-md font-headline-md font-semibold text-on-surface tracking-tight">{album ? album.name : "All Photos"}</h1>
          )}
          <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high border border-outline-variant/40 text-on-surface-variant text-label-sm font-label-sm">
            {total} photos{album || albumFilter != null ? " in album" : " indexed"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-space-sm w-full md:w-auto">
          {!album && (
            <div className="relative flex-1 min-w-[9rem] md:flex-none">
              <Icon name="collections_bookmark" className="text-[16px] text-outline absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                data-testid="album-filter"
                value={albumFilter ?? ""}
                onChange={(e) => setAlbumFilter(e.target.value ? Number(e.target.value) : null)}
                className="w-full h-11 pl-9 pr-8 appearance-none rounded-xl bg-surface-container border border-outline-variant/60 text-on-surface text-label-md font-label-md hover:bg-surface-container-high focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
              >
                <option value="">All albums</option>
                {albums.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <Icon name="expand_more" className="text-[16px] text-outline absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
          <button
            onClick={() => setFavorites((f) => !f)}
            data-testid="favorites-filter"
            aria-pressed={favorites}
            title={favorites ? "Showing starred only" : "Show starred only"}
            className={`h-11 w-11 sm:w-auto px-0 sm:px-space-md rounded-xl border text-label-md font-label-md flex items-center justify-center gap-space-xs transition-colors ${
              favorites
                ? "bg-amber-400/15 border-amber-400/40 text-amber-400 hover:text-amber-300"
                : "bg-surface-container border-outline-variant/60 text-on-surface hover:bg-surface-container-high"
            }`}
          >
            <Icon name={favorites ? "star" : "star_border"} className="text-[16px]" />
            <span className="hidden sm:inline">Starred</span>
          </button>
          <div className="relative w-full sm:w-80 order-last sm:order-none">
            <Icon name="search" className="text-[18px] text-outline absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by person name or file path…"
              className="w-full h-11 pl-9 pr-9 text-body-sm font-body-sm bg-surface-container border border-outline-variant/60 rounded-xl text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
            {query && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface" onClick={() => setQuery("")}>
                <Icon name="close" className="text-base" />
              </button>
            )}
          </div>
          <button
            onClick={() => setOrder((o) => (o === "newest" ? "oldest" : "newest"))}
            title={order === "newest" ? "Newest first" : "Oldest first"}
            aria-label={order === "newest" ? "Sorted newest first" : "Sorted oldest first"}
            className="h-11 w-11 sm:w-auto px-0 sm:px-space-md rounded-xl bg-surface-container border border-outline-variant/60 text-on-surface text-label-md font-label-md flex items-center justify-center gap-space-xs hover:bg-surface-container-high transition-colors"
          >
            <Icon name={order === "newest" ? "arrow_downward" : "arrow_upward"} className="text-[16px] text-outline" />
            <span className="hidden sm:inline">{order === "newest" ? "Newest first" : "Oldest first"}</span>
          </button>
        </div>
      </div>

      {/* Scrollable media canvas */}
      <div className="px-margin-md lg:px-margin-lg py-space-md pb-32 flex-1">
        {error && (
          <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
            <Icon name="error" className="text-base" />
            {error}
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-outline py-12 text-center">
            {debounced
              ? `No photos match “${debounced}”.`
              : album
                ? "No photos in this album yet. Open a photo and use “Add to album”, or scan a folder into it."
                : "No photos yet. Scan a folder to get started."}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label} className="mb-space-xl">
            <div className="mb-space-md flex items-center justify-between">
              <div className="flex items-center gap-space-sm">
                <span className="text-label-md font-label-md font-semibold text-on-surface">{g.label}</span>
              </div>
              <div className="flex-1 h-[1px] bg-outline-variant/30 ml-space-md" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {g.photos.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setOpenPhoto(p.id)}
                  className="relative group aspect-square rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/40 hover:border-outline cursor-pointer transition-all duration-200"
                >
                  <ImgWithFallback
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    sources={thumbSources(p.id, p.drive_file_id)}
                    alt={p.path}
                    placeholder={photoPlaceholder}
                  />
                  {album && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void setCover(p.id);
                        }}
                        title={coverId === p.id ? "Album cover" : "Set as album cover"}
                        className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all z-10 ${
                          coverId === p.id
                            ? "bg-primary text-on-primary opacity-100"
                            : "bg-black/60 hover:bg-primary hover:text-on-primary text-white opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <Icon name={coverId === p.id ? "check" : "wallpaper"} className="text-base" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeFromAlbum(p.id);
                        }}
                        title="Remove from album"
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 hover:bg-error text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all z-10"
                      >
                        <Icon name="close" className="text-base" />
                      </button>
                    </>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-surface-dim/95 via-surface-dim/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1.5">
                    {p.persons.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.persons.slice(0, 3).map((pp) => (
                          <button
                            key={pp.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenPerson?.(pp.id);
                            }}
                            title={`Open ${pp.name ?? `Person ${pp.id}`}`}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/90 hover:bg-indigo-400 text-white text-[11px] font-medium shadow-sm transition-colors max-w-full"
                          >
                            <Icon name={pp.name ? "person" : "person_outline"} className="text-[12px] shrink-0" />
                            <span className="truncate">{pp.name ?? `Person ${pp.id}`}</span>
                          </button>
                        ))}
                        {p.persons.length > 3 && (
                          <span className="flex items-center px-1.5 py-0.5 rounded-full bg-black/50 text-white text-[11px] font-medium">
                            +{p.persons.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[14px] font-mono text-on-surface">
                      <span className="truncate">{basename(p.path)}</span>
                      {p.width && p.height && <span className="text-primary font-sans shrink-0 ml-1">{p.width}×{p.height}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center pt-2">
            <button
              onClick={() => loadPage(items.length, order, debounced, false)}
              disabled={loading}
              className="px-space-lg py-2 rounded-xl bg-surface-container border border-outline-variant hover:border-primary text-on-surface text-label-md font-label-md flex items-center gap-2 transition-colors disabled:opacity-45"
            >
              <Icon name={loading ? "progress_activity" : "expand_more"} className={`text-base ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading…" : `Load more (${items.length} / ${total})`}
            </button>
          </div>
        )}
        {loading && items.length === 0 && (
          <div className="flex justify-center pt-2">
            <span className="px-space-lg py-2 rounded-xl bg-surface-container border border-outline-variant text-on-surface text-label-md font-label-md flex items-center gap-2">
              <Icon name="progress_activity" className="text-base animate-spin" />
              Loading…
            </span>
          </div>
        )}
      </div>

      {openPhoto != null && (() => {
        // Map the ?photo id to a position in the loaded list. If it isn't loaded
        // (e.g. a deep link to a photo past the first page), open it standalone
        // so the link still works — just without prev/next across the library.
        const pos = ids.indexOf(openPhoto);
        const inList = pos >= 0;
        const lbIds = inList ? ids : [openPhoto];
        const lbIndex = inList ? pos : 0;
        return (
          <Lightbox
            ids={lbIds}
            index={lbIndex}
            onIndexChange={(i) => setOpenPhoto(lbIds[i] ?? null)}
            onClose={() => setOpenPhoto(null)}
            driveIds={driveIds}
            canLoadMore={inList && hasMore && !loading}
            onLoadMore={() => loadPage(items.length, order, debounced, false)}
            onOpenPerson={
              onOpenPerson
                ? (pid) => {
                    setOpenPhoto(null);
                    onOpenPerson(pid);
                  }
                : undefined
            }
            onOpenSimilar={
              onOpenSimilar
                ? (pid) => {
                    setOpenPhoto(null);
                    onOpenSimilar(pid);
                  }
                : undefined
            }
          />
        );
      })()}
    </section>
  );
}
