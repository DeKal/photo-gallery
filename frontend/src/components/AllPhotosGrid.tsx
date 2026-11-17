import { useCallback, useEffect, useMemo, useState } from "react";
import { getPhotos, thumbUrl, type PhotoListItem, type PhotoOrder } from "../api";
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
}: {
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}) {
  const [items, setItems] = useState<PhotoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [order, setOrder] = useState<PhotoOrder>("newest");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const loadPage = useCallback((offset: number, ord: PhotoOrder, q: string, replace: boolean) => {
    setLoading(true);
    getPhotos(PAGE, offset, ord, q)
      .then((page) => {
        setTotal(page.total);
        setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <section className="flex flex-col flex-1">
      {/* Toolbar row */}
      <div className="px-margin-md lg:px-margin-lg pt-space-lg pb-space-md border-b border-outline-variant/40 flex flex-wrap items-center justify-between gap-space-md bg-surface/50 backdrop-blur-sm">
        <div className="flex items-center gap-space-sm">
          <h1 className="text-headline-md font-headline-md font-semibold text-on-surface tracking-tight">All Photos</h1>
          <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high border border-outline-variant/40 text-on-surface-variant text-label-sm font-label-sm">
            {total} photos indexed
          </span>
        </div>

        <div className="flex items-center gap-space-sm">
          <div className="relative w-80 max-w-full">
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
            className="h-11 px-space-md rounded-xl bg-surface-container border border-outline-variant/60 text-on-surface text-label-md font-label-md flex items-center gap-space-xs hover:bg-surface-container-high transition-colors"
          >
            <Icon name="sort" className="text-[16px] text-outline" />
            <span>{order === "newest" ? "Newest first" : "Oldest first"}</span>
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
            {debounced ? `No photos match “${debounced}”.` : "No photos yet. Scan a folder to get started."}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label} className="mb-space-xl">
            <div className="mb-space-md flex items-center justify-between">
              <div className="flex items-center gap-space-sm">
                <span className="text-label-md font-label-md font-semibold text-on-surface">{g.label}</span>
                <span className="text-outline text-body-sm font-body-sm">• {g.photos.length} items</span>
              </div>
              <div className="flex-1 h-[1px] bg-outline-variant/30 ml-space-md" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {g.photos.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setLightbox(ids.indexOf(p.id))}
                  className="relative group aspect-square rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/40 hover:border-outline cursor-pointer transition-all duration-200"
                >
                  <ImgWithFallback
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    sources={[thumbUrl(p.id)]}
                    alt={p.path}
                    placeholder={photoPlaceholder}
                  />
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-surface-dim/95 via-surface-dim/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1.5">
                    {p.persons.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.persons.map((pp) => (
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
          <div className="flex justify-center pt-2">
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
        {loading && items.length === 0 && <div className="text-outline py-12 text-center">Loading photos…</div>}
      </div>

      {lightbox != null && (
        <Lightbox
          ids={ids}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          onOpenPerson={
            onOpenPerson
              ? (pid) => {
                  setLightbox(null);
                  onOpenPerson(pid);
                }
              : undefined
          }
          onOpenSimilar={
            onOpenSimilar
              ? (pid) => {
                  setLightbox(null);
                  onOpenSimilar(pid);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
