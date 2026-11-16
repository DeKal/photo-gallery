import { useEffect, useRef, useState } from "react";
import { startScan, getScan, cluster, type Scan } from "../api";

interface Props {
  // Called once a scan has completed AND clustering has finished, so the
  // active view can refresh its data.
  onClustered: () => void;
}

type Phase = "idle" | "scanning" | "clustering" | "done" | "error";

export default function ScanBar({ onClustered }: Props) {
  const [path, setPath] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    };
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
          void runClustering();
        } else if (s.status === "failed") {
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
      const { scan_id } = await startScan(path.trim());
      poll(scan_id);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const total = scan?.total ?? 0;
  const done = scan?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="scanbar">
        <input
          type="text"
          placeholder="/path/to/your/photos"
          data-testid="scan-input"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void onScan();
          }}
          disabled={busy}
        />
        <button
          className="primary"
          data-testid="scan-btn"
          onClick={() => void onScan()}
          disabled={busy || !path.trim()}
        >
          {phase === "scanning"
            ? "Scanning…"
            : phase === "clustering"
              ? "Clustering…"
              : "Scan"}
        </button>
      </div>

      {(scan || phase === "clustering") && (
        <div className="progress">
          <div className="progress-meta">
            <span
              className={`status-pill ${
                phase === "clustering" ? "running" : scan?.status ?? ""
              }`}
              data-testid="scan-status"
            >
              {phase === "clustering" ? "clustering" : scan?.status}
            </span>
            {scan && (
              <span>
                {done} / {total} images
              </span>
            )}
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${phase === "clustering" ? 100 : pct}%` }}
            />
          </div>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
