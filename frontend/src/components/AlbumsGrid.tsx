import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getAlbums,
  createAlbum,
  deleteAlbum,
  renameAlbum,
  thumbSources,
  type Album,
} from "../api";
import AlbumView from "./AlbumView";
import AlbumDialog from "./AlbumDialog";
import ImgWithFallback from "./ImgWithFallback";
import LoadingPill from "./LoadingPill";
import Icon from "./Icon";

const coverPlaceholder = (
  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface-container to-surface text-outline-variant" aria-hidden="true">
    <Icon name="collections_bookmark" className="text-4xl" />
  </div>
);

// Albums view: a grid of album cards (cover + name + count). Selecting an album
// drills into its photos via AllPhotosGrid in album mode; the back button
// returns here. Creating/deleting albums are plain DB writes, so this whole view
// works in no-worker deployments too.
export default function AlbumsGrid({
  onOpenPerson,
  onOpenSimilar,
}: {
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Selected album comes from /albums/:albumId so the detail view is linkable.
  const navigate = useNavigate();
  const params = useParams();
  const openAlbumId = params.albumId ? Number(params.albumId) : null;
  const selected = openAlbumId != null ? albums.find((a) => a.id === openAlbumId) ?? null : null;
  // Modal for naming an album; replaces window.prompt for create + rename.
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "rename"; album: Album } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAlbums()
      .then((a) => {
        setAlbums(a);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitDialog = async (name: string) => {
    const d = dialog;
    if (!d) return;
    setDialog(null);
    try {
      if (d.mode === "create") await createAlbum(name);
      else await renameAlbum(d.album.id, name);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (album: Album) => {
    if (!window.confirm(`Delete album “${album.name}”? The photos themselves are kept.`)) return;
    try {
      await deleteAlbum(album.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (selected) {
    return (
      <AlbumView
        key={`album-${selected.id}`}
        album={{ id: selected.id, name: selected.name, coverPhotoId: selected.cover_photo_id }}
        onBack={() => {
          navigate("/albums");
          load();
        }}
        onAlbumChanged={load}
        onOpenPerson={onOpenPerson}
        onOpenSimilar={onOpenSimilar}
      />
    );
  }

  return (
    <section className="flex flex-col flex-1">
      <div className="px-margin-md lg:px-margin-lg pt-space-lg pb-space-md border-b border-outline-variant/40 flex flex-wrap items-center justify-between gap-space-md bg-surface/50 backdrop-blur-sm">
        <div className="flex items-center gap-space-sm">
          <h1 className="text-headline-md font-headline-md font-semibold text-on-surface tracking-tight">Albums</h1>
          <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high border border-outline-variant/40 text-on-surface-variant text-label-sm font-label-sm">
            {albums.length} {albums.length === 1 ? "album" : "albums"}
          </span>
        </div>
        <button
          onClick={() => setDialog({ mode: "create" })}
          className="h-11 px-space-md rounded-xl bg-surface-container border border-outline-variant/60 text-on-surface text-label-md font-label-md flex items-center gap-space-xs hover:bg-surface-container-high transition-colors"
        >
          <Icon name="add" className="text-[16px] text-primary" />
          <span>New album</span>
        </button>
      </div>

      <div className="px-margin-md lg:px-margin-lg py-space-lg pb-32 flex-1">
        {error && (
          <div className="mb-4 text-body-sm text-error flex items-center gap-1.5">
            <Icon name="error" className="text-base" />
            {error}
          </div>
        )}
        {!loading && albums.length === 0 && (
          <div className="text-outline py-12 text-center">
            No albums yet. Create one, then add photos from a photo’s “Add to album”, or scan a folder into an album.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-space-lg">
          {albums.map((a) => (
            <div
              key={a.id}
              onClick={() => navigate(`/albums/${a.id}`)}
              className="group relative rounded-2xl bg-surface-container overflow-hidden shadow-lg cursor-pointer transition-all duration-300 hover:scale-[1.015] hover:shadow-primary/10 border border-outline-variant hover:border-primary/40"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-surface-container-lowest">
                {a.cover_photo_id != null ? (
                  <ImgWithFallback
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    sources={thumbSources(a.cover_photo_id, a.cover_drive_file_id)}
                    alt={a.name}
                    placeholder={coverPlaceholder}
                  />
                ) : (
                  coverPlaceholder
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/20 to-transparent opacity-95" />

                {/* Rename / delete actions */}
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDialog({ mode: "rename", album: a });
                    }}
                    title="Rename album"
                    className="w-7 h-7 rounded-full bg-surface-container-lowest/80 backdrop-blur-md border border-white/10 hover:border-white/30 text-white flex items-center justify-center transition-all"
                  >
                    <Icon name="edit" className="text-[15px]" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDelete(a);
                    }}
                    title="Delete album"
                    className="w-7 h-7 rounded-full bg-surface-container-lowest/80 backdrop-blur-md border border-white/10 hover:bg-error hover:border-error text-white flex items-center justify-center transition-all"
                  >
                    <Icon name="delete" className="text-[15px]" />
                  </button>
                </div>

                {/* Bottom overlay: name + count */}
                <div className="absolute bottom-3 left-3 right-3 min-w-0">
                  <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface tracking-tight break-words group-hover:text-primary transition-colors">
                    {a.name}
                  </h3>
                  <p className="font-body-sm text-body-sm text-outline mt-0.5">
                    {a.photo_count} {a.photo_count === 1 ? "photo" : "photos"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {loading && albums.length === 0 && <LoadingPill />}
      </div>

      {dialog && (
        <AlbumDialog
          title={dialog.mode === "create" ? "New album" : "Rename album"}
          initial={dialog.mode === "rename" ? dialog.album.name : ""}
          confirmLabel={dialog.mode === "create" ? "Create" : "Rename"}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => void submitDialog(name)}
        />
      )}
    </section>
  );
}
