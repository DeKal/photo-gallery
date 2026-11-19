import { useSearchParams } from "react-router-dom";
import AllPhotosGrid from "./AllPhotosGrid";
import PeopleGrid from "./PeopleGrid";
import SimilarGrid from "./SimilarGrid";
import Icon from "./Icon";

type Tab = "photos" | "people" | "similar";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "photos", label: "Photos", icon: "photo_library" },
  { key: "people", label: "People", icon: "person" },
  { key: "similar", label: "Similar", icon: "burst_mode" },
];

// Album detail: one album browsed three ways. The album's photos, and the
// People / Similar clusters derived from just those photos (the backend scopes
// each query by album), so an album's faces and sets reflect that album alone.
// This view owns the shared Back + title + tab switch; the child grids render
// embedded (AllPhotosGrid drops its own header, People/Similar keep only their
// functional toolbars).
export default function AlbumView({
  album,
  onBack,
  onOpenPerson,
  onOpenSimilar,
  onAlbumChanged,
}: {
  album: { id: number; name: string; coverPhotoId?: number | null };
  onBack: () => void;
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
  // Fired when the album's cover changes, so the parent card can refresh.
  onAlbumChanged?: () => void;
}) {
  // The active tab lives in `?tab=` so an album's People/Similar view is linkable.
  // Switching tabs clears any open ?photo (it belonged to the previous tab's list).
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab");
  const tab: Tab = raw === "people" || raw === "similar" ? raw : "photos";
  const setTab = (t: Tab) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("photo");
        if (t === "photos") n.delete("tab");
        else n.set("tab", t);
        return n;
      },
      { replace: true },
    );

  return (
    <section className="flex flex-col flex-1">
      <div className="px-margin-md lg:px-margin-lg pt-space-lg pb-space-md border-b border-outline-variant/40 flex flex-wrap items-center gap-space-md bg-surface/50 backdrop-blur-sm">
        <button
          onClick={onBack}
          title="Back to albums"
          className="text-on-surface-variant hover:text-on-surface flex items-center gap-1 text-label-md font-label-md transition-colors"
        >
          <Icon name="arrow_back" className="text-xl" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <h1 className="text-headline-md font-headline-md font-semibold text-on-surface tracking-tight break-words">{album.name}</h1>
        <div className="flex w-full md:w-auto md:inline-flex p-1 rounded-2xl bg-[#0c0e13] border border-[#232736] md:ml-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-space-lg py-1.5 rounded-xl font-label-md text-label-md transition-colors ${
                tab === t.key
                  ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              <Icon name={t.icon} className="text-base" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "photos" && (
        <AllPhotosGrid
          key={`album-photos-${album.id}`}
          album={album}
          embedded
          onAlbumChanged={onAlbumChanged}
          onOpenPerson={onOpenPerson}
          onOpenSimilar={onOpenSimilar}
        />
      )}
      {tab === "people" && (
        <PeopleGrid
          key={`album-people-${album.id}`}
          album={album.id}
          albumName={album.name}
          onOpenPerson={onOpenPerson}
          onOpenSimilar={onOpenSimilar}
        />
      )}
      {tab === "similar" && (
        <SimilarGrid
          key={`album-similar-${album.id}`}
          album={album.id}
          albumName={album.name}
          onOpenPerson={onOpenPerson}
          onOpenSimilar={onOpenSimilar}
        />
      )}
    </section>
  );
}
