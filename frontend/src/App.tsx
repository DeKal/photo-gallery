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
import { useAuth } from "./auth";

// Prod deploys (e.g. Vercel) have no ML worker, so scanning and folder import
// are unavailable. VITE_NO_WORKER=1 hides that UI; browsing + curation (which
// hit the DB-only API and still write) stay available. Beyond that, the
// scan/import surface is also admin-only (worker functions are gated).
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
  const { isAdmin } = useAuth();

  // Worker-backed actions (scan, folder import) require both a deployed worker
  // and an authenticated admin.
  const showWorker = !NO_WORKER && isAdmin;

  const [refreshKey, setRefreshKey] = useState(0);
  const [scanPath, setScanPath] = useState("");
  const [counts, setCounts] = useState<Counts>({ all: null, people: null, similar: null, hidden: null, albums: null });

  // Cross-view navigation now goes through the URL so any landing spot is a
  // shareable link: open a person, or jump to a photo's "More like this".
  const openPerson = (id: number) => navigate(`/people/${id}`);
  const openSimilar = (photoId: number) => navigate(`/similar/photo/${photoId}`);
  const onNav = (key: NavKey) => navigate(key === "all" ? "/all" : `/${key}`);

  useEffect(() => {
    getPersons({ limit: 1 })
      .then((p) => setCounts((c) => ({ ...c, people: p.total })))
      .catch(() => {});
    getPersons({ hiddenOnly: true, limit: 1 })
      .then((p) => setCounts((c) => ({ ...c, hidden: p.total })))
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
    <AppShell nav={nav} onNav={onNav} onImportFolder={showWorker ? importFolder : undefined} counts={counts}>
      {showScanHeader && (
        <section className="p-space-lg lg:px-margin-lg lg:pt-space-xl border-b border-outline-variant/60 bg-[#111318]/70 backdrop-blur-md">
          {showWorker && (
            <div className="hidden md:block">
              <ScanBar onClustered={reload} path={scanPath} onPathChange={setScanPath} />
            </div>
          )}

          {/* Segmented mode switch: People vs Similar */}
          <div className={`flex items-center justify-between ${showWorker ? "md:mt-space-lg md:border-t md:border-outline-variant/40 md:pt-space-md" : ""}`}>
            <div className="flex items-center gap-space-md">
              {peopleActive && (
                <>
                  <h1 className="text-headline-sm md:text-headline-md font-headline-md font-semibold text-on-surface tracking-tight">People</h1>
                  {counts.people != null && (
                    <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high border border-outline-variant/40 text-on-surface-variant text-label-sm font-label-sm">
                      {counts.people} people
                    </span>
                  )}
                </>
              )}
              {nav === "similar" && (
                <>
                  <h1 className="text-headline-sm md:text-headline-md font-headline-md font-semibold text-on-surface tracking-tight">Similar</h1>
                  {counts.similar != null && (
                    <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high border border-outline-variant/40 text-on-surface-variant text-label-sm font-label-sm">
                      {counts.similar} sets
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="hidden md:flex items-center gap-2 text-outline text-body-sm font-body-sm">
              <Icon name="auto_awesome" className="text-sm" />
              <span>Clustered by CLIP + InsightFace on-device</span>
            </div>
          </div>
        </section>
      )}

      {nav === "all" && showWorker && (
        <section className="hidden md:block p-space-lg lg:px-margin-lg lg:pt-space-xl border-b border-outline-variant/60 bg-[#111318]/70 backdrop-blur-md">
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
          path="/people/*"
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
