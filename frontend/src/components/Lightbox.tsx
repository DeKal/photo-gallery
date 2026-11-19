import { useEffect, useRef, useState } from "react";
import {
  imageSources,
  getPhotoPersons,
  getPhotoFavorite,
  setPhotoFavorite,
  downloadPhoto,
  getAlbums,
  getPhotoAlbums,
  createAlbum,
  addPhotosToAlbum,
  removePhotosFromAlbum,
  type PhotoPerson,
  type Album,
} from "../api";
import Icon from "./Icon";
import AlbumDialog from "./AlbumDialog";

interface Props {
  // Ordered list of photo ids the viewer can page through.
  ids: number[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  // Per-id Google Drive file id (when the photo came from Drive). The viewer
  // shows the Drive image and falls back to the local copy if it fails.
  driveIds?: Record<number, string | null>;
  // Per-id original filename, so Download saves under the real Drive name.
  names?: Record<number, string>;
  // Click a person tag to open that person. Omit to hide the tags.
  onOpenPerson?: (id: number) => void;
  // Show a "More like this" action that opens visual-similarity for the photo.
  onOpenSimilar?: (id: number) => void;
  // When at the last loaded image, fetch the next page instead of dead-ending.
  canLoadMore?: boolean;
  onLoadMore?: () => void;
}

// Retry cycles for the full image after all candidates fail (Drive 429s).
const MAX_FULL_RETRIES = 4;

// Full-screen overlay showing one image at full resolution with prev/next
// navigation. Click the backdrop or press Escape to dismiss; ←/→ to page.
// The same viewer is reused by All Photos, People and Similar — it fetches the
// photo's people itself so every caller gets identical display + actions.
export default function Lightbox({ ids, index, onIndexChange, onClose, driveIds, names, onOpenPerson, onOpenSimilar, canLoadMore, onLoadMore }: Props) {
  const count = ids.length;
  const id = ids[index];
  const hasPrev = index > 0;
  const hasNext = index < count - 1 || !!canLoadMore;

  // When advancing past the last loaded image, ask the host to load the next
  // page, then step forward once it arrives.
  const [wantNext, setWantNext] = useState(false);
  const goNext = () => {
    if (index < count - 1) onIndexChange(index + 1);
    else if (canLoadMore && onLoadMore) {
      setWantNext(true);
      onLoadMore();
    }
  };

  // Touch swipe (mobile): a horizontal drag past the threshold pages prev/next.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Horizontal, and clearly more horizontal than vertical (not a scroll).
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) {
      if (hasPrev) onIndexChange(index - 1);
    } else {
      goNext();
    }
  };
  useEffect(() => {
    if (wantNext && index < count - 1) {
      onIndexChange(index + 1);
      setWantNext(false);
    }
  }, [count, wantNext, index, onIndexChange]);

  // Who is in this photo (named first). Fetched per-id so the viewer is
  // self-contained no matter which screen opened it.
  const [persons, setPersons] = useState<PhotoPerson[]>([]);
  useEffect(() => {
    if (id == null) return;
    let alive = true;
    setPersons([]);
    getPhotoPersons(id)
      .then((p) => {
        if (alive) setPersons(p);
      })
      .catch(() => {
        if (alive) setPersons([]);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // Favorite (star) state of the current photo. Fetched on open, toggled
  // optimistically by the star button and reverted if the write fails.
  const [favorite, setFavorite] = useState(false);
  useEffect(() => {
    if (id == null) return;
    let alive = true;
    setFavorite(false);
    getPhotoFavorite(id)
      .then((f) => {
        if (alive) setFavorite(f.favorite);
      })
      .catch(() => {
        if (alive) setFavorite(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const toggleFavorite = async () => {
    const next = !favorite;
    setFavorite(next);
    try {
      await setPhotoFavorite(id, next);
    } catch {
      setFavorite(!next);
    }
  };

  // Download + add-to-album actions. The album menu loads albums on open and is
  // dismissed whenever the viewed photo changes; `note` is a transient toast.
  // `memberIds` is which albums the current photo is already in, so the menu can
  // show membership and toggle it (add vs remove) rather than only ever adding.
  const [albumMenu, setAlbumMenu] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  // Open state of the "new album" naming dialog (proper modal, not prompt).
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const noteTimer = useRef<number | null>(null);
  useEffect(() => setAlbumMenu(false), [id]);
  useEffect(() => () => {
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
  }, []);

  const flash = (msg: string) => {
    setNote(msg);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 2000);
  };

  const toggleAlbumMenu = async () => {
    const next = !albumMenu;
    setAlbumMenu(next);
    if (next) {
      try {
        const [all, mine] = await Promise.all([getAlbums(), getPhotoAlbums(id)]);
        setAlbums(all);
        setMemberIds(new Set(mine.map((a) => a.id)));
      } catch {
        setAlbums([]);
        setMemberIds(new Set());
      }
    }
  };

  // Toggle membership. A photo lives in one album only, so adding to an album
  // moves it there (the backend drops any other membership) — reflect that by
  // replacing the member set rather than adding to it.
  const toggleMembership = async (album: Album) => {
    const inIt = memberIds.has(album.id);
    try {
      if (inIt) {
        await removePhotosFromAlbum(album.id, [id]);
        setMemberIds(new Set());
        flash(`Removed from ${album.name}`);
      } else {
        await addPhotosToAlbum(album.id, [id]);
        setMemberIds(new Set([album.id]));
        flash(`Moved to ${album.name}`);
      }
    } catch {
      flash("Could not update album");
    }
  };

  const addToNew = async (name: string) => {
    setNewAlbumOpen(false);
    try {
      const a = await createAlbum(name);
      await addPhotosToAlbum(a.id, [id]);
      setMemberIds(new Set([a.id]));
      flash(`Moved to ${a.name}`);
    } catch {
      flash("Could not create album");
    }
  };

  // Full-res photos are large, so the previous frame lingers while the next
  // one downloads. Show a thumbnail instantly + a spinner until the full image
  // decodes, and preload the neighbours so paging feels instant.
  // Drive-backed photos are shown from Drive first (index 0) and fall back to
  // the local copy on error — hence the per-image source index state.
  const driveId = driveIds?.[id] ?? null;
  // Phones get a lighter 1200px render; desktops the sharper 2000px.
  const viewW =
    typeof window !== "undefined" && window.innerWidth < 640 ? 1200 : 2000;
  const fullSrcs = imageSources(id, driveId, viewW);
  const [fullI, setFullI] = useState(0);
  // Retry cycles after every candidate fails — Drive rate-limits (429) full
  // images under a burst; back off and retry rather than hang on the spinner.
  const [fullRetry, setFullRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const fullTimer = useRef<number | null>(null);
  useEffect(() => {
    setLoaded(false);
    setFullI(0);
    setFullRetry(0);
  }, [id]);
  useEffect(
    () => () => {
      if (fullTimer.current !== null) window.clearTimeout(fullTimer.current);
    },
    [],
  );
  useEffect(() => {
    for (const n of [index - 1, index + 1]) {
      const nid = ids[n];
      if (nid != null) {
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.src = imageSources(nid, driveIds?.[nid] ?? null, viewW)[0];
      }
    }
  }, [ids, index, driveIds, viewW]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onIndexChange, index, count, canLoadMore]);

  if (id == null) return null;

  return (
    <div
      data-testid="lightbox"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0b0d12]/90 backdrop-blur-lg"
    >
      {/* Top-right controls: star, prominent download, close. */}
      <div className="fixed top-4 right-4 z-10 flex items-center gap-2">
        <button
          data-testid="lightbox-favorite-top"
          aria-pressed={favorite}
          onClick={(e) => {
            e.stopPropagation();
            void toggleFavorite();
          }}
          title={favorite ? "Starred" : "Star photo"}
          className={`h-10 w-10 justify-center px-0 sm:w-auto sm:px-space-md sm:justify-start rounded-full backdrop-blur-md border font-label-md text-label-md active:scale-[0.98] transition-all flex items-center gap-2 ${
            favorite
              ? "bg-amber-400/15 border-amber-400/40 text-amber-400 hover:text-amber-300"
              : "bg-[#171922]/80 border-white/10 text-on-surface hover:text-white hover:border-white/30"
          }`}
        >
          <Icon name={favorite ? "star" : "star_border"} className="text-base" />
          <span className="hidden sm:inline">{favorite ? "Starred" : "Star"}</span>
        </button>
        <button
          data-testid="lightbox-download"
          onClick={(e) => {
            e.stopPropagation();
            void downloadPhoto(id, driveId, names?.[id]);
          }}
          title="Download photo"
          className="h-10 w-10 justify-center px-0 sm:w-auto sm:px-space-md sm:justify-start rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-label-md text-label-md shadow-lg shadow-indigo-500/30 active:scale-[0.98] transition-all flex items-center gap-2"
        >
          <Icon name="download" className="text-base" />
          <span className="hidden sm:inline">Download</span>
        </button>
        <button
          aria-label="Close"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 text-on-surface hover:text-white hover:border-white/30 flex items-center justify-center transition-all"
        >
          <Icon name="close" className="text-xl" />
        </button>
      </div>

      {/* Add to album — top-left, menu opens downward. */}
      <div className="fixed top-4 left-4 z-10" onClick={(e) => e.stopPropagation()}>
        <button
          data-testid="lightbox-add-album"
          onClick={() => void toggleAlbumMenu()}
          title="Add to album"
          className="h-10 w-10 justify-center px-0 sm:w-auto sm:px-space-md sm:justify-start rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 hover:border-white/30 text-on-surface hover:text-white font-label-md text-label-md active:scale-[0.98] transition-all flex items-center gap-2"
        >
          <Icon name="bookmark_add" className="text-base" />
          <span className="hidden sm:inline">Add to album</span>
        </button>
        {albumMenu && (
          <div className="absolute top-full mt-2 left-0 w-56 max-h-72 overflow-y-auto custom-scroll rounded-xl bg-[#171922] border border-white/10 shadow-2xl py-1 z-10">
            <button
              onClick={() => {
                setAlbumMenu(false);
                setNewAlbumOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-label-md font-label-md text-primary hover:bg-white/5 transition-colors"
            >
              <Icon name="add" className="text-base" />
              New album…
            </button>
            {albums.length > 0 && <div className="my-1 h-px bg-white/10" />}
            {albums.map((a) => {
              const inIt = memberIds.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => void toggleMembership(a)}
                  title={inIt ? `Remove from ${a.name}` : `Add to ${a.name}`}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-label-md font-label-md text-on-surface hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Icon
                      name={inIt ? "check_circle" : "collections_bookmark"}
                      className={`text-base shrink-0 ${inIt ? "text-emerald-400" : "text-outline"}`}
                    />
                    <span className={`truncate ${inIt ? "text-white" : ""}`}>{a.name}</span>
                  </span>
                  <span className="text-outline text-label-sm shrink-0">{a.photo_count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Prev */}
      {hasPrev && (
        <button
          aria-label="Previous"
          data-testid="lightbox-prev"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          className="fixed left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 text-on-surface hover:text-white hover:border-white/30 flex items-center justify-center transition-all"
        >
          <Icon name="chevron_left" className="text-2xl" />
        </button>
      )}
      {/* Next */}
      {hasNext && (
        <button
          aria-label="Next"
          data-testid="lightbox-next"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="fixed right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 text-on-surface hover:text-white hover:border-white/30 flex items-center justify-center transition-all"
        >
          <Icon name="chevron_right" className="text-2xl" />
        </button>
      )}

      <div className="relative flex flex-col items-center cursor-default" onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="relative h-[70vh] sm:h-[86vh] flex items-center justify-center">
          {/* Single image: Drive first (index 0), local copy on error. A spinner
              covers the gap until it decodes — no separate thumbnail request. */}
          <img
            key={`full-${id}`}
            src={(() => {
              const b = fullSrcs[Math.min(fullI, fullSrcs.length - 1)];
              return fullRetry > 0 ? `${b}${b.includes("?") ? "&" : "?"}retry=${fullRetry}` : b;
            })()}
            alt={`Photo ${id}`}
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => {
              if (fullI < fullSrcs.length - 1) {
                setFullI((i) => i + 1); // try the next candidate (local copy)
              } else if (fullRetry < MAX_FULL_RETRIES) {
                const delay = Math.min(8000, 500 * 2 ** fullRetry) + Math.random() * 400;
                fullTimer.current = window.setTimeout(() => {
                  setFullRetry((r) => r + 1);
                  setFullI(0);
                }, delay);
              }
            }}
            className={`h-full w-auto max-w-[94vw] object-contain rounded-xl ring-1 ring-white/10 transition-opacity duration-200 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            style={{ boxShadow: "0 24px 60px -12px rgba(0,0,0,0.7), 0 0 40px rgba(99,102,241,0.15)" }}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Icon name="progress_activity" className="text-3xl text-white/80 animate-spin" />
            </div>
          )}
          {/* More like this — floating over the image, bottom-centered. */}
          {onOpenSimilar && (
            <button
              data-testid="lightbox-action"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSimilar(id);
              }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap px-space-lg py-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-label-md text-label-md shadow-lg shadow-indigo-500/30 ring-1 ring-white/20 active:scale-[0.98] transition-all flex items-center gap-2"
            >
              <Icon name="auto_awesome" className="text-base" />
              More like this
            </button>
          )}
        </div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-[94vw] max-h-[22vh] sm:max-h-[12vh] overflow-y-auto custom-scroll flex flex-col items-center gap-3">
          {note && (
            <div className="text-label-sm font-label-sm text-emerald-400 flex items-center gap-1.5">
              <Icon name="check_circle" className="text-base" />
              {note}
            </div>
          )}
          {onOpenPerson && persons.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-[90vw]">
              {persons.map((pp) => (
                <button
                  key={pp.id}
                  data-testid="lightbox-person"
                  onClick={() => onOpenPerson(pp.id)}
                  title={`Open ${pp.name ?? `Person ${pp.id}`}`}
                  className="flex items-center gap-1.5 pl-2 pr-3 py-1 rounded-full bg-[#171922]/90 border border-white/10 hover:border-indigo-400 text-on-surface hover:text-white text-label-md font-label-md transition-colors"
                >
                  <Icon name={pp.name ? "person" : "person_outline"} className="text-[16px] text-primary" />
                  {pp.name ?? `Person ${pp.id}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {newAlbumOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <AlbumDialog
            title="New album"
            confirmLabel="Create & add"
            onCancel={() => setNewAlbumOpen(false)}
            onSubmit={(name) => void addToNew(name)}
          />
        </div>
      )}
    </div>
  );
}
