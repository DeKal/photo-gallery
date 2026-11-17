import { useCallback, useEffect, useState } from "react";
import {
  getPersons,
  mergePersons,
  faceThumbUrl,
  thumbUrl,
  type Person,
} from "../api";
import ImgWithFallback from "./ImgWithFallback";
import PersonDetail from "./PersonDetail";

const personPlaceholder = (
  <div className="thumb thumb-placeholder" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
    </svg>
  </div>
);

export default function PeopleGrid() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getPersons()
      .then((p) => {
        setPersons(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  if (openId !== null) {
    return (
      <PersonDetail
        personId={openId}
        onBack={() => setOpenId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div>
      <div className="toolbar">
        {!selectMode ? (
          <button onClick={() => setSelectMode(true)}>Select</button>
        ) : (
          <>
            <button onClick={exitSelect}>Cancel</button>
            <span className="hint">{selected.size} selected</span>
            {selected.size >= 2 && (
              <button
                className="primary"
                onClick={() => void doMerge()}
                disabled={merging}
              >
                {merging ? "Merging…" : `Merge selected (${selected.size})`}
              </button>
            )}
          </>
        )}
        <div className="spacer" />
        <button onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div className="loading">Loading people…</div>}
      {!loading && persons.length === 0 && (
        <div className="empty">No people yet. Scan a folder to get started.</div>
      )}

      <div className="grid">
        {persons.map((p) => (
          <div
            key={p.id}
            className={`card ${selected.has(p.id) ? "selected" : ""}`}
            data-testid="person-card"
            onClick={() => (selectMode ? toggle(p.id) : setOpenId(p.id))}
          >
            {selectMode && (
              <input
                type="checkbox"
                className="card-check"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            {p.cover_face_id != null || p.cover_photo_id != null ? (
              <ImgWithFallback
                className="thumb"
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
            <div className="card-body">
              <div className="card-title">{p.name ?? "Unnamed"}</div>
              <div className="card-sub">
                {p.face_count} {p.face_count === 1 ? "face" : "faces"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
