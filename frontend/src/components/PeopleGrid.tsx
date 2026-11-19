import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getPersons, getAlbums, mergePersons, hidePerson, unhidePerson, faceThumbUrl, thumbUrl, type Album, type Person } from "../api";
import ImgWithFallback from "./ImgWithFallback";
import PersonDetail from "./PersonDetail";
import LoadingPill from "./LoadingPill";
import Icon from "./Icon";
import { useIsDesktop } from "../useIsDesktop";

// Curation (select/merge, hide) is disabled on read-only deploys (Vercel sets
// VITE_READONLY=1) and on mobile, where these destructive actions aren't used.
const READONLY = import.meta.env.VITE_READONLY === "1";

// People load in pages (infinite scroll) like All Photos, not all at once.
const PAGE = 120;

const personPlaceholder = (
  <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-surface-container to-surface text-outline-variant" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[38%] h-[38%]">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
    </svg>
  </div>
);

interface Props {
  initialShowHidden?: boolean;
  hiddenOnly?: boolean;
  // When set, People are scoped to this album (counts/covers reflect it).
  album?: number;
  // URL-driven mode (top-level People): the open person comes from /people/:id
  // and opening/closing navigates, so the person detail is a shareable link.
  // Omitted when embedded in album detail, where open state stays internal.
  routed?: boolean;
  // Auto-open this person (focused from another view). Nonce re-triggers.
  focus?: { id: number; n: number } | null;
  // Cross-view handlers passed through to the photo viewer.
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}

export default function PeopleGrid({
  initialShowHidden = false,
  hiddenOnly = false,
  album,
  routed = false,
  focus = null,
  onOpenPerson,
  onOpenSimilar,
}: Props) {
  const navigate = useNavigate();
  const params = useParams();
  const routedPersonId = routed && params.personId ? Number(params.personId) : null;

  // Select/merge + hide are shown only on desktop and only when not read-only.
  const canCurate = useIsDesktop() && !READONLY;

  const [persons, setPersons] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalOpen, setInternalOpen] = useState<number | null>(null);
  const openId = routed ? routedPersonId : internalOpen;
  const [showHidden, setShowHidden] = useState(initialShowHidden);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // Top-level People can be narrowed to one album; when embedded in album-detail
  // the `album` prop pins it and this picker is hidden.
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumFilter, setAlbumFilter] = useState<number | null>(null);
  const effectiveAlbum = album ?? albumFilter ?? undefined;
  // Remember the gallery scroll position so returning from a person restores it.
  const scrollPos = useRef(0);

  useEffect(() => {
    if (album != null) return;
    getAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
  }, [album]);

  const scroller = () => document.querySelector<HTMLElement>("main.custom-scroll");

  function openPerson(id: number) {
    const el = scroller();
    scrollPos.current = el && el.scrollTop > 0 ? el.scrollTop : window.scrollY;
    if (routed) navigate(`/people/${id}`);
    else setInternalOpen(id);
  }

  function closePerson() {
    if (routed) navigate("/people");
    else setInternalOpen(null);
  }

  useLayoutEffect(() => {
    const target = openId === null ? scrollPos.current : 0;
    const el = scroller();
    if (el) el.scrollTop = target;
    window.scrollTo(0, target);
  }, [openId]);

  const loadPage = useCallback(
    (offset: number, q: string, replace: boolean) => {
      setLoading(true);
      getPersons({
        includeHidden: hiddenOnly ? true : showHidden,
        hiddenOnly,
        album: effectiveAlbum,
        q,
        limit: PAGE,
        offset,
      })
        .then((page) => {
          setTotal(page.total);
          setPersons((prev) => (replace ? page.items : [...prev, ...page.items]));
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [showHidden, hiddenOnly, effectiveAlbum],
  );

  // Reload from the first page — used after merge/hide and when filters change.
  const reload = useCallback(() => {
    setPersons([]);
    loadPage(0, debounced, true);
  }, [loadPage, debounced]);

  // Debounce the name filter so each keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPersons([]);
    loadPage(0, debounced, true);
  }, [debounced, loadPage]);

  const hasMore = persons.length < total;

  // Infinite scroll: fetch the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadPage(persons.length, debounced, false);
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, persons.length, debounced, loadPage]);

  // Open a person requested from another view (All Photos chip, etc.). Only in
  // the internal (album-embedded) mode — routed mode opens via the URL.
  useEffect(() => {
    if (focus && !routed) setInternalOpen(focus.id);
  }, [focus, routed]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function doMerge() {
    if (selected.size < 2) return;
    setMerging(true);
    try {
      await mergePersons([...selected]);
      exitSelect();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  }

  async function toggleHidden(p: Person) {
    setBusy((prev) => new Set(prev).add(p.id));
    try {
      if (p.hidden) await unhidePerson(p.id);
      else await hidePerson(p.id);
      setPersons((prev) =>
        hiddenOnly || !showHidden ? prev.filter((x) => x.id !== p.id) : prev.map((x) => (x.id === p.id ? { ...x, hidden: !x.hidden } : x))
      );
      // Dropped from this list? Shrink the total so the count/"load more" agree.
      if (hiddenOnly || !showHidden) setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }

  if (openId !== null) {
    return (
      <PersonDetail
        personId={openId}
        album={effectiveAlbum}
        onBack={closePerson}
        onChanged={reload}
        onOpenPerson={onOpenPerson}
        onOpenSimilar={onOpenSimilar}
      />
    );
  }

  return (
    <>
      {/* GALLERY CONTROLS & STATS BAR */}
      <section className="px-space-lg lg:px-margin-lg py-space-md flex flex-wrap items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-md">
          {canCurate &&
            (!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="px-space-md py-1.5 rounded-xl bg-[#171922] border border-[#232736] hover:border-primary text-on-surface text-label-md font-label-md flex items-center gap-2 transition-colors"
            >
              <Icon name="check_box" className="text-base text-primary" />
              Select
            </button>
          ) : (
            <>
              <button
                onClick={exitSelect}
                className="px-space-md py-1.5 rounded-xl bg-[#171922] border border-[#232736] hover:border-outline-variant text-on-surface text-label-md font-label-md transition-colors"
              >
                Cancel
              </button>
              <span className="text-body-sm font-body-sm text-outline">{selected.size} selected</span>
            </>
          ))}
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-space-sm w-full md:w-auto">
          {/* Row 1 (mobile): album filter + search */}
          <div className="flex items-center gap-space-sm">
            {album == null && (
              <div className="relative flex-1 md:flex-none min-w-[9rem]">
                <Icon name="collections_bookmark" className="text-[16px] text-outline absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  data-testid="people-album-filter"
                  value={albumFilter ?? ""}
                  onChange={(e) => setAlbumFilter(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-9 pl-9 pr-8 appearance-none rounded-xl bg-[#171922] border border-[#232736] text-on-surface text-label-md font-label-md hover:border-outline-variant focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
                >
                  <option value="">All albums</option>
                  {albums.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <Icon name="expand_more" className="text-[16px] text-outline absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
            <div className="flex items-center flex-1 md:flex-none bg-[#171922] border border-[#232736] rounded-xl px-3 h-9 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
              <Icon name="search" className="text-outline text-base mr-1.5" />
              <input
                type="text"
                data-testid="people-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name…"
                className="w-full md:w-48 bg-transparent text-on-surface text-label-md font-label-md outline-none border-none p-0 focus:ring-0 placeholder:text-outline"
              />
              {query && (
                <button className="ml-1 text-outline hover:text-on-surface" title="Clear filter" onClick={() => setQuery("")}>
                  <Icon name="close" className="text-sm" />
                </button>
              )}
            </div>
          </div>
          {/* Row 2 (mobile): show-hidden left, reload + density right */}
          <div className="flex items-center gap-space-sm">
            {!hiddenOnly && (
              <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#171922] border border-[#232736] cursor-pointer hover:border-outline-variant">
                <input className="sr-only peer" type="checkbox" checked={showHidden} onChange={() => setShowHidden((v) => !v)} />
                <div className="w-8 h-4 bg-surface-container peer-checked:bg-indigo-600 rounded-full transition-colors relative">
                  <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 left-0.5 peer-checked:left-[17px] transition-all" />
                </div>
                <span className="text-label-md font-label-md text-on-surface-variant">Show hidden</span>
              </label>
            )}
            <div className="flex items-center gap-space-sm ml-auto">
              <div className="flex items-center bg-[#171922] border border-[#232736] rounded-xl p-0.5">
                <button
                  onClick={() => setDensity("comfortable")}
                  className={`p-1 rounded-lg ${density === "comfortable" ? "bg-surface-container-high text-primary" : "text-outline hover:text-on-surface"}`}
                  title="Comfortable grid"
                >
                  <Icon name="grid_view" className="text-base" />
                </button>
                <button
                  onClick={() => setDensity("compact")}
                  className={`p-1 rounded-lg ${density === "compact" ? "bg-surface-container-high text-primary" : "text-outline hover:text-on-surface"}`}
                  title="Compact grid"
                >
                  <Icon name="apps" className="text-base" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GALLERY 5-COLUMN PEOPLE GRID */}
      <section className="px-space-lg lg:px-margin-lg pb-32 flex-1">
        {error && (
          <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
            <Icon name="error" className="text-base" />
            {error}
          </div>
        )}
        {loading && persons.length === 0 && <LoadingPill />}
        {!loading && persons.length === 0 && (
          <div className="text-outline py-12 text-center">
            {debounced
              ? `No people match “${debounced}”.`
              : hiddenOnly
                ? "No hidden people."
                : "No people yet. Scan a folder to get started."}
          </div>
        )}

        <div
          className={`grid gap-space-lg ${
            density === "compact"
              ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 2xl:grid-cols-10"
              : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-7"
          }`}
        >
          {persons.map((p) => {
            const isSel = selected.has(p.id);
            const unnamed = !p.name;
            return (
              <div
                key={p.id}
                data-testid="person-card"
                onClick={() => (selectMode ? toggle(p.id) : openPerson(p.id))}
                className={`group relative rounded-2xl bg-[#171922] overflow-hidden cursor-pointer transition-all duration-300 ${
                  isSel
                    ? "border border-indigo-500/80 ring-2 ring-indigo-500/30 shadow-xl shadow-indigo-500/10 scale-[1.02]"
                    : "border border-[#232736] hover:border-indigo-500/50 hover:shadow-lg"
                } ${p.hidden ? "opacity-70" : ""}`}
              >
                {/* Select check (top-left) */}
                {selectMode && (
                  <div className="absolute top-2.5 left-2.5 z-20">
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center text-white text-xs shadow-sm ${isSel ? "bg-indigo-600" : "bg-[#0b0d12]/70 ring-1 ring-white/30"}`}>
                      {isSel && <Icon name="check" className="text-sm" />}
                    </div>
                  </div>
                )}

                {/* Hide badge (top-right) */}
                {!selectMode && canCurate && (
                  <div className={`absolute top-2.5 right-2.5 z-20 transition-opacity ${p.hidden ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    <button
                      data-testid="person-hide-btn"
                      title={p.hidden ? "Unhide this person" : "Hide this person"}
                      disabled={busy.has(p.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleHidden(p);
                      }}
                      className="px-2.5 py-1 rounded-full bg-[#0b0d12]/85 backdrop-blur-md border border-white/10 hover:border-white/30 text-white text-label-sm font-label-sm flex items-center gap-1 transition-all disabled:opacity-50"
                    >
                      <Icon name={p.hidden ? "visibility" : "visibility_off"} className="text-xs" />
                      {p.hidden ? "Unhide" : "Hide"}
                    </button>
                  </div>
                )}

                {/* Image (4:5) */}
                <div className={`aspect-[4/5] w-full overflow-hidden bg-surface-container ${p.hidden ? "grayscale" : ""}`}>
                  {p.cover_face_id != null || p.cover_photo_id != null ? (
                    <ImgWithFallback
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      sources={[
                        p.cover_face_id != null ? faceThumbUrl(p.cover_face_id) : null,
                        p.cover_photo_id != null ? thumbUrl(p.cover_photo_id) : null,
                      ].filter((s): s is string => s != null)}
                      alt={p.name ?? "Unnamed"}
                      placeholder={personPlaceholder}
                    />
                  ) : (
                    personPlaceholder
                  )}
                </div>

                {/* Label footer — sits below the image so the gradient/text
                    never covers the face. */}
                <div className="px-3 py-2 flex flex-col justify-end">
                  {unnamed ? (
                    <>
                      <h3 className="text-body-sm md:text-body-lg font-headline-sm font-semibold text-on-surface tracking-tight truncate">Unnamed (Person {p.id})</h3>
                      <p className="text-label-sm font-label-sm text-primary mt-0.5 truncate">
                        {p.face_count} {p.face_count === 1 ? "face" : "faces"} • Click to label
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-1">
                        <h3 className="text-body-sm md:text-body-lg font-headline-sm font-bold text-white tracking-tight truncate">{p.name}</h3>
                        <Icon name="verified" className="text-indigo-400 text-xs shrink-0" />
                      </div>
                      <p className="text-label-sm font-label-sm text-outline mt-0.5">
                        {p.face_count} {p.face_count === 1 ? "face" : "faces"}
                        {p.hidden ? " • hidden" : ""}
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && persons.length > 0 && (
          <div ref={sentinelRef} className="flex justify-center pt-space-lg">
            <button
              onClick={() => loadPage(persons.length, debounced, false)}
              disabled={loading}
              className="px-space-lg py-2 rounded-xl bg-[#171922] border border-[#232736] hover:border-primary text-on-surface text-label-md font-label-md flex items-center gap-2 transition-colors disabled:opacity-45"
            >
              <Icon name={loading ? "progress_activity" : "expand_more"} className={`text-base ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading…" : `Load more (${persons.length} / ${total})`}
            </button>
          </div>
        )}
      </section>

      {/* FLOATING STATUS / ACTION DOCK */}
      {canCurate && selectMode && selected.size >= 2 ? (
        <aside className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-space-md px-space-xl py-space-sm bg-[#171922]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl shadow-black/80 ring-1 ring-white/5">
          <p className="text-label-md font-label-md text-on-surface border-r border-[#232736] pr-space-lg">{selected.size} selected</p>
          <button
            onClick={() => void doMerge()}
            disabled={merging}
            className="px-space-lg py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-label-md text-label-md shadow-md shadow-indigo-500/25 active:scale-[0.98] transition-all flex items-center gap-1.5 disabled:opacity-60"
          >
            <Icon name="call_merge" className="text-base" />
            {merging ? "Merging…" : `Merge ${selected.size}`}
          </button>
        </aside>
      ) : (
        canCurate &&
        !selectMode &&
        persons.length > 0 && (
          <aside className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-space-sm px-space-lg py-space-sm bg-[#171922]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl shadow-black/80 ring-1 ring-white/5">
            <button
              onClick={() => setSelectMode(true)}
              className="px-space-md py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-variant text-on-surface border border-outline-variant text-label-md font-label-md active:scale-[0.98] transition-all flex items-center gap-1.5"
            >
              <Icon name="call_merge" className="text-base" />
              Merge Similar
            </button>
          </aside>
        )
      )}
    </>
  );
}
