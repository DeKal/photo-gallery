import { useEffect, useState } from "react";
import AppShell, { type NavKey, type Counts } from "./components/AppShell";
import ScanBar from "./components/ScanBar";
import PeopleGrid from "./components/PeopleGrid";
import SimilarGrid from "./components/SimilarGrid";
import AllPhotosGrid from "./components/AllPhotosGrid";
import Icon from "./components/Icon";
import { getPersons, getSimClusters, getPhotos, pickFolder } from "./api";

export default function App() {
  const [nav, setNav] = useState<NavKey>("people");
  const [refreshKey, setRefreshKey] = useState(0);
  const [scanPath, setScanPath] = useState("");
  const [counts, setCounts] = useState<Counts>({ all: null, people: null, similar: null, hidden: null });
  // Person to auto-open in the People view (e.g. clicked from All Photos). The
  // nonce lets the same person be re-focused after you navigate away and back.
  const [focus, setFocus] = useState<{ id: number; n: number } | null>(null);

  const openPerson = (id: number) => {
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    setNav("people");
  };

  useEffect(() => {
    getPersons(false)
      .then((p) => setCounts((c) => ({ ...c, people: p.length })))
      .catch(() => {});
    getPersons(true)
      .then((all) =>
        setCounts((c) => ({ ...c, hidden: all.filter((p) => p.hidden).length }))
      )
      .catch(() => {});
    getSimClusters()
      .then((s) => setCounts((c) => ({ ...c, similar: s.length })))
      .catch(() => {});
    getPhotos(1, 0, "newest")
      .then((page) => setCounts((c) => ({ ...c, all: page.total })))
      .catch(() => {});
  }, [refreshKey]);

  const importFolder = async () => {
    try {
      const { path } = await pickFolder();
      if (path) {
        setScanPath(path);
        if (nav !== "people" && nav !== "similar" && nav !== "hidden") setNav("people");
      }
    } catch {
      // Picker cancelled or unavailable — ignore.
    }
  };

  const reload = () => setRefreshKey((k) => k + 1);

  const peopleActive = nav === "people" || nav === "hidden";
  const showScanHeader = nav === "people" || nav === "similar" || nav === "hidden";

  return (
    <AppShell nav={nav} onNav={setNav} onImportFolder={importFolder} counts={counts}>
      {showScanHeader && (
        <section className="p-space-lg lg:px-margin-lg lg:pt-space-xl border-b border-outline-variant/60 bg-[#111318]/70 backdrop-blur-md">
          <ScanBar onClustered={reload} path={scanPath} onPathChange={setScanPath} />

          {/* Segmented mode switch: People vs Similar */}
          <div className="mt-space-lg flex items-center justify-between border-t border-outline-variant/40 pt-space-md">
            <div className="inline-flex p-1 rounded-2xl bg-[#0c0e13] border border-[#232736]">
              <button
                onClick={() => setNav("people")}
                className={`flex items-center gap-2 px-space-lg py-1.5 rounded-xl font-label-md text-label-md transition-colors ${
                  peopleActive
                    ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                <Icon name="person" className="text-base" />
                <span>People</span>
                {counts.people != null && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-label-sm font-label-sm ${
                      peopleActive ? "bg-white/20 text-white" : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {counts.people} people
                  </span>
                )}
              </button>
              <button
                onClick={() => setNav("similar")}
                className={`flex items-center gap-2 px-space-lg py-1.5 rounded-xl font-label-md text-label-md transition-colors ${
                  nav === "similar"
                    ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                <Icon name="burst_mode" className="text-base" />
                <span>Similar</span>
                {counts.similar != null && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-label-sm font-label-sm ${
                      nav === "similar" ? "bg-white/20 text-white" : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {counts.similar} sets
                  </span>
                )}
              </button>
            </div>
            <div className="hidden md:flex items-center gap-2 text-outline text-body-sm font-body-sm">
              <Icon name="auto_awesome" className="text-sm" />
              <span>Clustered by CLIP + InsightFace on-device</span>
            </div>
          </div>
        </section>
      )}

      {(nav === "people" || nav === "hidden") && (
        <PeopleGrid
          key={`people-${nav}-${refreshKey}`}
          initialShowHidden={nav === "hidden"}
          hiddenOnly={nav === "hidden"}
          focus={nav === "people" ? focus : null}
        />
      )}
      {nav === "similar" && <SimilarGrid key={`similar-${refreshKey}`} />}
      {nav === "all" && <AllPhotosGrid key={`all-${refreshKey}`} onOpenPerson={openPerson} />}
    </AppShell>
  );
}
