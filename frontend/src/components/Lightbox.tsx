import { useEffect, useState } from "react";
import { imageUrl, thumbUrl, getPhotoPersons, type PhotoPerson } from "../api";
import Icon from "./Icon";

interface Props {
  // Ordered list of photo ids the viewer can page through.
  ids: number[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  // Click a person tag to open that person. Omit to hide the tags.
  onOpenPerson?: (id: number) => void;
  // Show a "More like this" action that opens visual-similarity for the photo.
  onOpenSimilar?: (id: number) => void;
}

// Full-screen overlay showing one image at full resolution with prev/next
// navigation. Click the backdrop or press Escape to dismiss; ←/→ to page.
// The same viewer is reused by All Photos, People and Similar — it fetches the
// photo's people itself so every caller gets identical display + actions.
export default function Lightbox({ ids, index, onIndexChange, onClose, onOpenPerson, onOpenSimilar }: Props) {
  const count = ids.length;
  const id = ids[index];
  const hasPrev = index > 0;
  const hasNext = index < count - 1;

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

  // Full-res photos are large, so the previous frame lingers while the next
  // one downloads. Show a thumbnail instantly + a spinner until the full image
  // decodes, and preload the neighbours so paging feels instant.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [id]);
  useEffect(() => {
    for (const n of [index - 1, index + 1]) {
      const nid = ids[n];
      if (nid != null) {
        const img = new Image();
        img.src = imageUrl(nid);
      }
    }
  }, [ids, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      else if (e.key === "ArrowRight" && index < count - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onIndexChange, index, count]);

  if (id == null) return null;

  return (
    <div
      data-testid="lightbox"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0b0d12]/90 backdrop-blur-lg cursor-zoom-out"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed top-4 right-4 w-10 h-10 rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 text-on-surface hover:text-white hover:border-white/30 flex items-center justify-center transition-all"
      >
        <Icon name="close" className="text-xl" />
      </button>

      {/* Prev */}
      {hasPrev && (
        <button
          aria-label="Previous"
          data-testid="lightbox-prev"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          className="fixed left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 text-on-surface hover:text-white hover:border-white/30 flex items-center justify-center transition-all"
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
            onIndexChange(index + 1);
          }}
          className="fixed right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#171922]/80 backdrop-blur-md border border-white/10 text-on-surface hover:text-white hover:border-white/30 flex items-center justify-center transition-all"
        >
          <Icon name="chevron_right" className="text-2xl" />
        </button>
      )}

      <div className="relative flex flex-col items-center cursor-default" onClick={(e) => e.stopPropagation()}>
        <div className="relative h-[86vh] flex items-center justify-center">
          {/* Instant low-res thumbnail underneath (blurred until full loads). */}
          <img
            key={`thumb-${id}`}
            src={thumbUrl(id)}
            alt=""
            aria-hidden="true"
            className={`h-full w-auto max-w-[94vw] object-contain rounded-xl transition-opacity duration-200 ${
              loaded ? "opacity-0" : "opacity-100 blur-[6px]"
            }`}
          />
          {/* Full-resolution image, fades in once decoded. */}
          <img
            key={`full-${id}`}
            src={imageUrl(id)}
            alt={`Photo ${id}`}
            onLoad={() => setLoaded(true)}
            className={`absolute inset-0 w-full h-full object-contain rounded-xl ring-1 ring-white/10 transition-opacity duration-200 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            style={{ boxShadow: "0 24px 60px -12px rgba(0,0,0,0.7), 0 0 40px rgba(99,102,241,0.15)" }}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Icon name="progress_activity" className="text-3xl text-white/80 animate-spin" />
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-col items-center gap-3">
          <div className="flex items-center gap-4">
            <span className="text-body-sm font-body-sm text-outline tabular-nums">
              {index + 1} / {count}
            </span>
            {onOpenSimilar && (
              <button
                data-testid="lightbox-action"
                onClick={() => onOpenSimilar(id)}
                className="px-space-lg py-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-label-md text-label-md shadow-lg shadow-indigo-500/30 active:scale-[0.98] transition-all flex items-center gap-2"
              >
                <Icon name="auto_awesome" className="text-base" />
                More like this
              </button>
            )}
          </div>
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
    </div>
  );
}
