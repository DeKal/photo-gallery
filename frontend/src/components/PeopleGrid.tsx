import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getPersons, mergePersons, hidePerson, unhidePerson, faceThumbUrl, thumbUrl, type Person } from "../api";
import ImgWithFallback from "./ImgWithFallback";
import PersonDetail from "./PersonDetail";
import Icon from "./Icon";

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
  // Auto-open this person (focused from another view). Nonce re-triggers.
  focus?: { id: number; n: number } | null;
  // Cross-view handlers passed through to the photo viewer.
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}

export default function PeopleGrid({
  initialShowHidden = false,
  hiddenOnly = false,
  focus = null,
  onOpenPerson,
  onOpenSimilar,
}: Props) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(initialShowHidden);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [query, setQuery] = useState("");
  // Remember the gallery scroll position so returning from a person restores it.
  const scrollPos = useRef(0);

  const scroller = () => document.querySelector<HTMLElement>("main.custom-scroll");

  function openPerson(id: number) {
    const el = scroller();
    scrollPos.current = el && el.scrollTop > 0 ? el.scrollTop : window.scrollY;
    setOpenId(id);
  }

  useLayoutEffect(() => {
    const target = openId === null ? scrollPos.current : 0;
    const el = scroller();
    if (el) el.scrollTop = target;
    window.scrollTo(0, target);
  }, [openId]);

  const load = useCallback(() => {
    setLoading(true);
    getPersons(hiddenOnly ? true : showHidden)
      .then((p) => {
        const list = hiddenOnly ? p.filter((x) => x.hidden) : p;
        // Named people first (stable — keeps the existing face-count order within each group).
        setPersons([...list].sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1)));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [showHidden, hiddenOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // Open a person requested from another view (All Photos chip, etc.).
  useEffect(() => {
    if (focus) setOpenId(focus.id);
  }, [focus]);

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
      load();
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
        onBack={() => setOpenId(null)}
        onChanged={load}
        onOpenPerson={onOpenPerson}
        onOpenSimilar={onOpenSimilar}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? persons.filter((p) =>
        p.name
          ? p.name.toLowerCase().includes(q)
          : `person ${p.id}`.includes(q) || String(p.id).includes(q)
      )
    : persons;

  return (
    <>
      {/* GALLERY CONTROLS & STATS BAR */}
      <section className="px-space-lg lg:px-margin-lg py-space-md flex flex-wrap items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-md">
          {!selectMode ? (
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
          )}
          <span className="text-body-sm font-body-sm text-outline">
            Showing <strong className="text-on-surface font-semibold">{visible.length} {hiddenOnly ? "hidden" : visible.length === 1 ? "subject" : "identified subjects"}</strong>
            {q && persons.length !== visible.length ? <span className="text-outline"> of {persons.length}</span> : null}
          </span>
        </div>

        <div className="flex items-center gap-space-sm">
          <div className="flex items-center bg-[#171922] border border-[#232736] rounded-xl px-3 h-9 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
            <Icon name="search" className="text-outline text-base mr-1.5" />
            <input
              type="text"
              data-testid="people-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name…"
              className="w-36 sm:w-48 bg-transparent text-on-surface text-label-md font-label-md outline-none border-none p-0 focus:ring-0 placeholder:text-outline"
            />
            {query && (
              <button className="ml-1 text-outline hover:text-on-surface" title="Clear filter" onClick={() => setQuery("")}>
                <Icon name="close" className="text-sm" />
              </button>
            )}
          </div>
          {!hiddenOnly && (
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#171922] border border-[#232736] cursor-pointer hover:border-outline-variant">
              <input className="sr-only peer" type="checkbox" checked={showHidden} onChange={() => setShowHidden((v) => !v)} />
              <div className="w-8 h-4 bg-surface-container peer-checked:bg-indigo-600 rounded-full transition-colors relative">
                <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 left-0.5 peer-checked:left-[17px] transition-all" />
              </div>
              <span className="text-label-md font-label-md text-on-surface-variant">Show hidden</span>
            </label>
          )}
          <button
            onClick={load}
            disabled={loading}
            title="Reload faces"
            className="w-9 h-9 rounded-xl bg-[#171922] border border-[#232736] flex items-center justify-center text-outline hover:text-on-surface hover:border-outline-variant transition-colors disabled:opacity-45"
          >
            <Icon name="refresh" className={`text-lg ${loading ? "animate-spin" : ""}`} />
          </button>
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
      </section>

      {/* GALLERY 5-COLUMN PEOPLE GRID */}
      <section className="px-space-lg lg:px-margin-lg pb-32 flex-1">
        {error && (
          <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
            <Icon name="error" className="text-base" />
            {error}
          </div>
        )}
        {loading && <div className="text-outline py-12 text-center">Loading people…</div>}
        {!loading && persons.length === 0 && (
          <div className="text-outline py-12 text-center">
            {hiddenOnly ? "No hidden people." : "No people yet. Scan a folder to get started."}
          </div>
        )}
        {!loading && persons.length > 0 && visible.length === 0 && (
          <div className="text-outline py-12 text-center">No people match “{query}”.</div>
        )}

        <div
          className={`grid gap-space-lg ${
            density === "compact"
              ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 2xl:grid-cols-10"
              : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-7"
          }`}
        >
          {visible.map((p) => {
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
                {!selectMode && (
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

                {/* Bottom scrim + label */}
                <div className="absolute inset-x-0 bottom-0 p-4 pt-10 bg-gradient-to-t from-[#0b0d12] via-[#0b0d12]/75 to-transparent flex flex-col justify-end">
                  {unnamed ? (
                    <>
                      <h3 className="text-headline-sm font-headline-sm font-semibold text-on-surface tracking-tight truncate">Unnamed (Person {p.id})</h3>
                      <p className="text-body-sm font-body-sm text-primary mt-0.5 truncate">
                        {p.face_count} {p.face_count === 1 ? "face" : "faces"} • Click to label
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-headline-sm font-headline-sm font-bold text-white tracking-tight truncate">{p.name}</h3>
                        <Icon name="verified" className="text-indigo-400 text-sm shrink-0" />
                      </div>
                      <p className="text-body-sm font-body-sm text-outline mt-0.5">
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
      </section>

      {/* FLOATING STATUS / ACTION DOCK */}
      {selectMode && selected.size >= 2 ? (
        <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-space-md px-space-xl py-space-sm bg-[#171922]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl shadow-black/80 ring-1 ring-white/5">
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
        !selectMode &&
        persons.length > 0 && (
          <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-space-md px-space-xl py-space-sm bg-[#171922]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl shadow-black/80 ring-1 ring-white/5">
            <div className="flex items-center gap-2 border-r border-[#232736] pr-space-lg">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
              <p className="text-label-md font-label-md text-on-surface">
                {persons.length} {persons.length === 1 ? "cluster" : "clusters"} generated <span className="text-tertiary font-semibold">on-device</span>
              </p>
            </div>
            <div className="flex items-center gap-space-sm">
              <button
                onClick={() => setSelectMode(true)}
                className="px-space-md py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-variant text-on-surface border border-outline-variant text-label-md font-label-md active:scale-[0.98] transition-all flex items-center gap-1.5"
              >
                <Icon name="call_merge" className="text-base" />
                Merge Similar
              </button>
              <button className="px-space-lg py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-label-md text-label-md shadow-md shadow-indigo-500/25 active:scale-[0.98] transition-all flex items-center gap-1.5">
                <Icon name="file_upload" className="text-base" />
                Export Groups
              </button>
            </div>
          </aside>
        )
      )}
    </>
  );
}
