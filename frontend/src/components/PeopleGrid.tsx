import { useCallback, useEffect, useState } from "react";
import {
  getPersons,
  mergePersons,
  thumbUrl,
  type Person,
} from "../api";
import PersonDetail from "./PersonDetail";

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
            {p.cover_photo_id != null ? (
              <img
                className="thumb"
                src={thumbUrl(p.cover_photo_id)}
                alt={p.name ?? "Unnamed"}
                loading="lazy"
              />
            ) : (
              <div className="thumb" />
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
