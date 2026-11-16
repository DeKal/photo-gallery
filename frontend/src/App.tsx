import { useState } from "react";
import "./App.css";
import ScanBar from "./components/ScanBar";
import PeopleGrid from "./components/PeopleGrid";
import SimilarGrid from "./components/SimilarGrid";

type Tab = "people" | "similar";

export default function App() {
  const [tab, setTab] = useState<Tab>("people");
  // Bumped whenever a scan+cluster completes so the active view re-fetches.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="app">
      <div className="topbar">
        <h1>Photo Clustering</h1>
        <ScanBar onClustered={() => setRefreshKey((k) => k + 1)} />
        <div className="tabs">
          <button
            className={`tab ${tab === "people" ? "active" : ""}`}
            onClick={() => setTab("people")}
          >
            People
          </button>
          <button
            className={`tab ${tab === "similar" ? "active" : ""}`}
            onClick={() => setTab("similar")}
          >
            Similar
          </button>
        </div>
      </div>

      {tab === "people" ? (
        <PeopleGrid key={`people-${refreshKey}`} />
      ) : (
        <SimilarGrid key={`similar-${refreshKey}`} />
      )}
    </div>
  );
}
