import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AppShell, { type NavKey, type Counts } from "./components/AppShell";
import ScanBar from "./components/ScanBar";
import PeopleGrid from "./components/PeopleGrid";
import SimilarGrid from "./components/SimilarGrid";
import AllPhotosGrid from "./components/AllPhotosGrid";
import AlbumsGrid from "./components/AlbumsGrid";
import Icon from "./components/Icon";
import { getPersons, getSimClusters, getPhotos, getAlbums, pickFolder } from "./api";

// Prod deploys (e.g. Vercel) have no ML worker, so scanning and folder import
// are unavailable. VITE_NO_WORKER=1 hides that UI; browsing + curation (which
// hit the DB-only API and still write) stay available.
const NO_WORKER = import.meta.env.VITE_NO_WORKER === "1";

// Map the current hash path to a top-nav key for AppShell highlighting.
function navForPath(pathname: string): NavKey {
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/hidden")) return "hidden";
  if (pathname.startsWith("/similar")) return "similar";
  if (pathname.startsWith("/albums")) return "albums";
  return "all";
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = navForPath(location.pathname);

  const [refreshKey, setRefreshKey] = useState(0);
  const [scanPath, setScanPath] = useState("");
  const [counts, setCounts] = useState<Counts>({ all: null, people: null, similar: null, hidden: null, albums: null });

  // Cross-view navigation now goes through the URL so any landing spot is a
  // shareable link: open a person, or jump to a photo's "More like this".
  const openPerson = (id: number) => navigate(`/people/${id}`);
  const openSimilar = (photoId: number) => navigate(`/similar/photo/${photoId}`);
  const onNav = (key: NavKey) => navigate(key === "all" ? "/all" : `/${key}`);

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
    getAlbums()
      .then((a) => setCounts((c) => ({ ...c, albums: a.length })))
      .catch(() => {});
  }, [refreshKey]);

  const importFolder = async () => {
    try {
      const { path } = await pickFolder();
      if (path) {
        setScanPath(path);
        if (nav !== "people" && nav !== "similar" && nav !== "hidden") navigate("/people");
      }
    } catch {
      // Picker cancelled or unavailable — ignore.
    }
  };

  const reload = () => setRefreshKey((k) => k + 1);

  const peopleActive = nav === "people" || nav === "hidden";
  const showScanHeader = nav === "people" || nav === "similar" || nav === "hidden";

  return (
    <AppShell nav={nav} onNav={onNav} onImportFolder={NO_WORKER ? undefined : importFolder} counts={counts}>
      {showScanHeader && (
        <section className="p-space-lg lg:px-margin-lg lg:pt-space-xl border-b border-outline-variant/60 bg-[#111318]/70 backdrop-blur-md">
          {!NO_WORKER && <ScanBar onClustered={reload} path={scanPath} onPathChange={setScanPath} />}

          {/* Segmented mode switch: People vs Similar */}
          <div className={`flex items-center justify-between ${NO_WORKER ? "" : "mt-space-lg border-t border-outline-variant/40 pt-space-md"}`}>
            <div className="inline-flex p-1 rounded-2xl bg-[#0c0e13] border border-[#232736]">
              {peopleActive && (
              <button
                onClick={() => navigate("/people")}
                className="flex items-center gap-2 px-space-lg py-1.5 rounded-xl font-label-md text-label-md transition-colors bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30"
              >
                <Icon name="person" className="text-base" />
                <span>People</span>
                {counts.people != null && (
                  <span className="px-2 py-0.5 rounded-full text-label-sm font-label-sm bg-white/20 text-white">
                    {counts.people} people
                  </span>
                )}
              </button>
              )}
              {nav === "similar" && (
              <button
                onClick={() => navigate("/similar")}
                className="flex items-center gap-2 px-space-lg py-1.5 rounded-xl font-label-md text-label-md transition-colors bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30"
              >
                <Icon name="burst_mode" className="text-base" />
                <span>Similar</span>
                {counts.similar != null && (
                  <span className="px-2 py-0.5 rounded-full text-label-sm font-label-sm bg-white/20 text-white">
                    {counts.similar} sets
                  </span>
                )}
              </button>
              )}
            </div>
            <div className="hidden md:flex items-center gap-2 text-outline text-body-sm font-body-sm">
              <Icon name="auto_awesome" className="text-sm" />
              <span>Clustered by CLIP + InsightFace on-device</span>
            </div>
          </div>
        </section>
      )}

      {nav === "all" && !NO_WORKER && (
        <section className="p-space-lg lg:px-margin-lg lg:pt-space-xl border-b border-outline-variant/60 bg-[#111318]/70 backdrop-blur-md">
          <ScanBar onClustered={reload} path={scanPath} onPathChange={setScanPath} />
        </section>
      )}

      <Routes>
        <Route path="/" element={<Navigate to="/all" replace />} />
        <Route
          path="/all"
          element={<AllPhotosGrid key={`all-${refreshKey}`} onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/people"
          element={<PeopleGrid key={`people-${refreshKey}`} routed onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/people/:personId"
          element={<PeopleGrid key={`people-${refreshKey}`} routed onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/hidden"
          element={<PeopleGrid key={`hidden-${refreshKey}`} routed hiddenOnly initialShowHidden onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/similar"
          element={<SimilarGrid key={`similar-${refreshKey}`} routed onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/similar/cluster/:clusterId"
          element={<SimilarGrid key={`similar-${refreshKey}`} routed onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/similar/photo/:photoId"
          element={<SimilarGrid key={`similar-${refreshKey}`} routed onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/albums"
          element={<AlbumsGrid key={`albums-${refreshKey}`} onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route
          path="/albums/:albumId"
          element={<AlbumsGrid key={`albums-${refreshKey}`} onOpenPerson={openPerson} onOpenSimilar={openSimilar} />}
        />
        <Route path="*" element={<Navigate to="/all" replace />} />
      </Routes>
    </AppShell>
  );
}
