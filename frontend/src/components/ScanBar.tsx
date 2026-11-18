import { useEffect, useRef, useState } from "react";
import { startScan, getScan, cluster, pickFolder, getAlbums, type Scan, type Album } from "../api";
import Icon from "./Icon";

interface Props {
  // Called once a scan has completed AND clustering has finished, so the
  // active view can refresh its data.
  onClustered: () => void;
  // Controlled folder path (so the sidebar Import Folder can populate it).
  path: string;
  onPathChange: (path: string) => void;
}

type Phase = "idle" | "scanning" | "clustering" | "done" | "error";

// Remember the in-flight scan id so a page refresh re-attaches to it (the scan
// itself keeps running on the backend). Single scan at a time.
const STORAGE_KEY = "photocluster.activeScanId";

export default function ScanBar({ onClustered, path, onPathChange }: Props) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Optional album to ingest the scanned folder into (created on demand).
  // `albumSel` is the dropdown value: "" = none, an existing album name, or the
  // "__new__" sentinel which reveals a text box for a brand-new name.
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumSel, setAlbumSel] = useState("");
  const [newAlbum, setNewAlbum] = useState("");
  const albumName = albumSel === "__new__" ? newAlbum : albumSel;
  const pollRef = useRef<number | null>(null);

  // Load existing albums for the picker (refreshed after a scan completes).
  useEffect(() => {
    getAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    };
  }, []);

  // On mount, re-attach to a scan that was running when the page was left.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const id = Number(saved);
    if (!Number.isFinite(id)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    getScan(id)
      .then((s) => {
        setScan(s);
        if (s.status === "completed") {
          // Finished while away — run the clustering the prior session missed.
          void runClustering().finally(() => localStorage.removeItem(STORAGE_KEY));
        } else if (s.status === "failed") {
          setPhase("error");
          setError("Previous scan failed.");
          localStorage.removeItem(STORAGE_KEY);
        } else {
          setPhase("scanning");
          poll(id);
        }
      })
      .catch(() => localStorage.removeItem(STORAGE_KEY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase === "scanning" || phase === "clustering";

  async function runClustering() {
    setPhase("clustering");
    try {
      await cluster();
      setPhase("done");
      onClustered();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function poll(id: number) {
    getScan(id)
      .then((s) => {
        setScan(s);
        if (s.status === "completed") {
          localStorage.removeItem(STORAGE_KEY);
          void runClustering();
        } else if (s.status === "failed") {
          localStorage.removeItem(STORAGE_KEY);
          setPhase("error");
          setError("Scan failed.");
        } else {
          pollRef.current = window.setTimeout(() => poll(id), 1000);
        }
      })
      .catch((e) => {
        setPhase("error");
        setError(e instanceof Error ? e.message : String(e));
      });
  }

  async function onScan() {
    if (!path.trim()) return;
    setError(null);
    setScan(null);
    setPhase("scanning");
    try {
      const { scan_id } = await startScan(path.trim(), albumName.trim() || undefined);
      localStorage.setItem(STORAGE_KEY, String(scan_id));
      poll(scan_id);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onBrowse() {
    setError(null);
    try {
      const { path: picked } = await pickFolder();
      if (picked) onPathChange(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const total = scan?.total ?? 0;
  const done = scan?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const status = phase === "clustering" ? "clustering" : scan?.status ?? "";
  const completed = status === "completed";
  const failed = status === "failed";

  return (
    <div>
      {/* Scan bar input cluster */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-space-md mb-space-lg">
        <div className="flex-1 flex items-center bg-[#171922] border border-[#232736] rounded-xl px-3 py-2 shadow-inner focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
          <Icon name="folder" className="text-outline mr-2 text-[20px]" />
          <input
            type="text"
            data-testid="scan-input"
            className="w-full bg-transparent text-on-surface text-body-sm font-body-sm outline-none border-none p-0 focus:ring-0 placeholder:text-outline"
            placeholder="/path/to/your/photos or Google Drive folder link"
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void onScan();
            }}
            disabled={busy}
          />
          {path && !busy && (
            <button className="ml-2 text-outline hover:text-on-surface" title="Clear path" onClick={() => onPathChange("")}>
              <Icon name="close" className="text-base" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-space-sm">
          <div className="relative flex items-center bg-[#171922] border border-[#232736] rounded-xl pl-3 pr-2 py-2 shadow-inner focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
            <Icon name="collections_bookmark" className="text-outline mr-2 text-[18px]" />
            <select
              data-testid="scan-album-select"
              className="w-40 bg-transparent text-on-surface text-body-sm font-body-sm outline-none border-none p-0 pr-5 focus:ring-0 appearance-none cursor-pointer disabled:cursor-not-allowed [&>option]:bg-[#171922]"
              value={albumSel}
              onChange={(e) => setAlbumSel(e.target.value)}
              disabled={busy}
            >
              <option value="">No album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.name}>{a.name}</option>
              ))}
              <option value="__new__">＋ New album…</option>
            </select>
            <Icon name="expand_more" className="text-[16px] text-outline absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          {albumSel === "__new__" && (
            <div className="flex items-center bg-[#171922] border border-[#232736] rounded-xl px-3 py-2 shadow-inner focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
              <input
                type="text"
                data-testid="scan-album-input"
                autoFocus
                className="w-40 bg-transparent text-on-surface text-body-sm font-body-sm outline-none border-none p-0 focus:ring-0 placeholder:text-outline"
                placeholder="New album name…"
                value={newAlbum}
                onChange={(e) => setNewAlbum(e.target.value)}
                disabled={busy}
              />
            </div>
          )}
          <button
            data-testid="browse-btn"
            onClick={() => void onBrowse()}
            disabled={busy}
            className="px-space-lg py-2 rounded-xl bg-[#171922] border border-[#232736] hover:bg-surface-container hover:border-outline-variant text-on-surface text-label-md font-label-md active:scale-[0.98] transition-all flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Icon name="travel_explore" className="text-base" />
            Browse…
          </button>
          <button
            data-testid="scan-btn"
            onClick={() => void onScan()}
            disabled={busy || !path.trim()}
            className="px-space-xl py-2 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 hover:opacity-90 text-white font-label-md text-label-md shadow-lg shadow-indigo-500/25 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Icon name={busy ? "progress_activity" : "play_arrow"} className={`text-base ${busy ? "animate-spin" : ""}`} />
            {phase === "scanning" ? (scan?.status === "downloading" ? "Downloading…" : "Scanning…") : phase === "clustering" ? "Clustering…" : "Scan"}
          </button>
        </div>
      </div>

      {/* Progress & indexing row */}
      {(scan || phase === "clustering") && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md pb-space-xs">
          <div className="flex items-center gap-space-md">
            <div
              data-testid="scan-status"
              className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-label-sm font-label-sm ${
                completed
                  ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                  : failed
                    ? "bg-error/10 border-error/30 text-error"
                    : "bg-indigo-500/10 border-indigo-500/25 text-indigo-300"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
              {status}
            </div>
            {scan && (
              <span className="text-body-sm font-body-sm text-on-surface-variant font-medium">
                {done} / {total} {status === "downloading" ? "files downloaded" : "images indexed"}
              </span>
            )}
          </div>
          <div className="w-full sm:w-64 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${phase === "clustering" ? 100 : pct}%` }}
              />
            </div>
            <span className="text-label-sm font-label-sm text-outline">{phase === "clustering" ? "…" : `${pct}%`}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="pt-space-xs text-body-sm text-error flex items-center gap-1.5">
          <Icon name="error" className="text-base" />
          {error}
        </div>
      )}
    </div>
  );
}
