import { useEffect, useState } from "react";
import {
  getPerson,
  getPersonPhotos,
  getPersonFaces,
  downloadFaceCrop,
  setPersonCover,
  renamePerson,
  faceThumbUrl,
  thumbSources,
  type Person,
  type Photo,
  type Face,
} from "../api";
import ImgWithFallback from "./ImgWithFallback";
import Lightbox from "./Lightbox";
import { usePhotoParam } from "../useRouteState";
import Icon from "./Icon";

interface Props {
  personId: number;
  // When set, photos/faces/counts are scoped to this album.
  album?: number;
  onBack: () => void;
  onChanged: () => void;
  onOpenPerson?: (id: number) => void;
  onOpenSimilar?: (id: number) => void;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// Cover-face strip shows this many faces before the "Show all" expander.
const FACE_PREVIEW = 10;

const facePlaceholder = (
  <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-surface-container to-surface text-outline-variant" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[40%] h-[40%]">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
    </svg>
  </div>
);

const photoPlaceholder = (
  <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-surface-container to-surface text-outline-variant" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[34%] h-[34%]">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

// Ported from the Stitch "Person Detail — Elena Rostova" code.html, wired to
// real person data (rename, cover-face picker, photo lightbox). Decorative
// controls from the mock (Export Face Crops, Filter by Date, search, sort,
// density, meta tags) are shown inert to match the layout.
export default function PersonDetail({ personId, album, onBack, onChanged, onOpenPerson, onOpenSimilar }: Props) {
  const [person, setPerson] = useState<Person | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [faces, setFaces] = useState<Face[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [facesOpen, setFacesOpen] = useState(false);
  const [facesLoaded, setFacesLoaded] = useState(false);
  const [loadingFaces, setLoadingFaces] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingCover, setSettingCover] = useState(false);
  const [showAllFaces, setShowAllFaces] = useState(false);
  const [openPhoto, setOpenPhoto] = usePhotoParam();
  const [exporting, setExporting] = useState(false);

  // Download the person's current cover face crop. Falls back to the best
  // member face if no cover is set yet.
  async function downloadCurrentFace() {
    if (exporting) return;
    const faceId = person?.cover_face_id ?? faces[0]?.id ?? null;
    if (faceId == null) return;
    setExporting(true);
    try {
      await downloadFaceCrop(faceId, person?.name ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  // Load person metadata first so the hero paints immediately, then the photo
  // grid. Faces (the cover-face picker) are deferred until the user asks for
  // them — they're the heaviest list and rarely needed on every visit.
  useEffect(() => {
    setLoading(true);
    getPerson(personId, album)
      .then((p) => {
        setPerson(p);
        setName(p.name ?? "");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [personId, album]);

  useEffect(() => {
    setLoadingPhotos(true);
    getPersonPhotos(personId, album)
      .then((ph) => setPhotos(ph))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingPhotos(false));
  }, [personId, album]);

  // Reset the lazy faces panel whenever we switch person/album.
  useEffect(() => {
    setFaces([]);
    setFacesOpen(false);
    setFacesLoaded(false);
    setShowAllFaces(false);
  }, [personId, album]);

  async function loadFaces() {
    if (facesLoaded || loadingFaces) return;
    setLoadingFaces(true);
    try {
      const fc = await getPersonFaces(personId, album);
      setFaces(fc);
      setFacesLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFaces(false);
    }
  }

  function toggleFaces() {
    setFacesOpen((v) => {
      const next = !v;
      if (next) void loadFaces();
      return next;
    });
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await renamePerson(personId, name.trim());
      setPerson((p) => (p ? { ...p, name: name.trim() } : p));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function chooseCover(faceId: number) {
    if (person?.cover_face_id === faceId) return;
    setSettingCover(true);
    try {
      const updated = await setPersonCover(personId, faceId);
      setPerson(updated);
      setFaces((prev) => prev.map((f) => ({ ...f, is_cover: f.id === faceId })));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingCover(false);
    }
  }

  const coverSources = person?.cover_face_id != null ? [faceThumbUrl(person.cover_face_id)] : [];
  const displayName = person?.name ?? "Unnamed";

  return (
    <div className="flex-1 bg-darkroom-glow relative p-margin-md lg:p-margin-lg pb-32">
      <div className="w-full space-y-space-xl">
        {/* Sub-nav header */}
        <div className="flex items-center justify-between flex-wrap gap-space-md">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-space-xs text-label-md font-label-md text-on-surface-variant hover:text-primary transition-colors py-2 px-3 rounded-lg hover:bg-surface-container active:scale-[0.98]"
          >
            <Icon name="arrow_back" className="text-[18px]" />
            <span>Back to People</span>
          </button>
        </div>

        {error && (
          <div className="text-body-sm text-error flex items-center gap-1.5">
            <Icon name="error" className="text-base" />
            {error}
          </div>
        )}
        {loading && <div className="text-outline py-12 text-center">Loading person…</div>}

        {person && (
          <>
            {/* Hero card */}
            <section className="rounded-2xl p-6 bg-surface-container border border-outline-variant relative overflow-hidden shadow-lg">
              <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
              <div className="flex flex-col md:flex-row gap-space-xl items-start relative z-10">
                {/* Portrait */}
                <div className="relative shrink-0 group">
                  <div className="w-36 h-36 md:w-44 md:h-44 rounded-2xl overflow-hidden border border-outline-variant ring-2 ring-primary/20 shadow-md bg-surface-container-high">
                    <ImgWithFallback
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      sources={coverSources}
                      alt={displayName}
                      placeholder={facePlaceholder}
                    />
                  </div>
                  <button
                    data-testid="export-faces-btn"
                    onClick={() => void downloadCurrentFace()}
                    disabled={exporting || loading || !person || (person.cover_face_id == null && faces.length === 0)}
                    title="Download the current cover face crop"
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-surface-container-lowest/80 backdrop-blur-md border border-white/10 text-on-surface-variant hover:text-white hover:border-white/30 flex items-center justify-center transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <Icon name={exporting ? "progress_activity" : "download"} className={`text-[16px] ${exporting ? "animate-spin" : ""}`} />
                  </button>
                  <div className="absolute bottom-2 right-2 bg-surface-container-lowest/80 backdrop-blur-md px-2 py-0.5 rounded-md border border-white/10 text-[11px] font-mono text-primary flex items-center gap-1">
                    <Icon name="verified" className="text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }} />
                    <span>Verified</span>
                  </div>
                </div>

                {/* Detail block */}
                <div className="flex-1 space-y-space-md min-w-0">
                  <div>
                    <h1 className="text-headline-md font-headline-lg font-bold text-white tracking-tight">{displayName}</h1>
                    <p className="text-body-sm font-body-sm text-outline mt-1">
                      {person.face_count} {person.face_count === 1 ? "face" : "faces"} · {photos.length}{" "}
                      {photos.length === 1 ? "photo" : "photos"}
                    </p>
                  </div>

                  {/* Inline rename */}
                  <div className="flex items-center gap-space-sm pt-1">
                    <div className="relative flex-1 min-w-0 max-w-sm">
                      <input
                        type="text"
                        data-testid="person-name-input"
                        placeholder="Name this person"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && name.trim() && !saving) void save();
                        }}
                        className="w-full h-11 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant text-on-surface font-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-outline"
                      />
                    </div>
                    <button
                      data-testid="person-save-btn"
                      onClick={() => void save()}
                      disabled={saving || !name.trim()}
                      className="shrink-0 h-11 px-5 rounded-xl btn-gradient text-white font-medium text-label-md font-label-md active:scale-[0.98] transition-all disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>

                  {/* Lazy cover-face picker toggle — faces are fetched only on
                      first open so the page paints without waiting for them. */}
                  {person.face_count > 1 && (
                    <button
                      data-testid="toggle-faces"
                      onClick={toggleFaces}
                      className="flex items-center gap-1 text-label-sm font-label-md text-outline hover:text-primary transition-colors"
                    >
                      <Icon name={facesOpen ? "expand_less" : "tune"} className="text-[15px]" />
                      {loadingFaces ? "Loading faces…" : facesOpen ? "Hide cover face options" : "Change cover face"}
                    </button>
                  )}
                </div>
              </div>

              {/* Cover face picker — merged into the hero card, revealed by the
                  "Change cover face" toggle above. */}
              {facesOpen && (
                <div className="mt-space-lg pt-space-lg border-t border-outline-variant relative z-10" data-testid="face-picker">
                {loadingFaces ? (
                  <div className="text-outline py-6 text-center text-body-sm">Loading faces…</div>
                ) : faces.length === 0 ? (
                  <div className="text-outline py-6 text-center text-body-sm">No faces to choose from.</div>
                ) : (
                  <>
                <div className="flex items-center justify-between mb-space-md gap-space-md">
                  <div>
                    <h2 className="text-label-md font-label-md font-semibold text-on-surface flex items-center gap-2">
                      <Icon name="face" className="text-primary text-[18px]" />
                      <span>Cover face · click to choose</span>
                    </h2>
                    <p className="text-body-sm font-body-sm text-outline mt-0.5">
                      Used across clusters, exports, and thumbnail previews
                    </p>
                  </div>
                  {faces.length > FACE_PREVIEW ? (
                    <button
                      onClick={() => setShowAllFaces((v) => !v)}
                      className="shrink-0 text-label-sm font-label-md text-primary hover:text-white flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-surface-container-high transition-colors"
                    >
                      <Icon name={showAllFaces ? "expand_less" : "expand_more"} className="text-[16px]" />
                      {showAllFaces ? "Show less" : `Show all ${faces.length}`}
                    </button>
                  ) : (
                    <span className="text-label-sm font-mono text-outline shrink-0">{faces.length} detected angles</span>
                  )}
                </div>
                <div
                  className={`grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-10 gap-3 ${
                    showAllFaces ? "max-h-[24rem] overflow-y-auto custom-scroll pr-1" : ""
                  }`}
                >
                  {(showAllFaces ? faces : faces.slice(0, FACE_PREVIEW)).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      data-testid="face-chip"
                      title={`score ${f.det_score.toFixed(2)}`}
                      disabled={settingCover}
                      onClick={() => void chooseCover(f.id)}
                      className={`relative rounded-xl overflow-hidden aspect-square transition-all duration-200 disabled:opacity-70 ${
                        f.is_cover
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-surface shadow-md"
                          : "border border-outline-variant hover:border-primary/50"
                      }`}
                    >
                      <ImgWithFallback
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                        sources={[faceThumbUrl(f.id)]}
                        alt={`Face ${f.id}`}
                        placeholder={facePlaceholder}
                      />
                      {f.is_cover && (
                        <>
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-md">
                            <Icon name="check" className="text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }} />
                          </div>
                          <div className="absolute inset-x-0 bottom-0 py-0.5 bg-primary/80 backdrop-blur-sm text-[10px] font-mono text-on-primary text-center font-bold">
                            COVER
                          </div>
                        </>
                      )}
                    </button>
                  ))}
                </div>
                  </>
                )}
                </div>
              )}
            </section>

            {/* Gallery */}
            <section className="space-y-space-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md">
                <div className="flex items-center gap-space-sm">
                  <h2 className="text-headline-sm font-headline-sm font-semibold text-white">
                    Photos containing {displayName}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-label-sm font-label-sm bg-surface-container-high text-on-surface-variant border border-outline-variant font-mono">
                    {photos.length}
                  </span>
                </div>
                <div className="self-start sm:self-auto flex items-center bg-surface-container rounded-lg border border-outline-variant p-0.5">
                  <span className="p-1 rounded bg-surface-container-high text-primary" title="Dense grid">
                    <Icon name="grid_view" className="text-[16px]" />
                  </span>
                  <span className="p-1 rounded text-outline" title="Comfortable grid">
                    <Icon name="view_module" className="text-[16px]" />
                  </span>
                </div>
              </div>

              {loadingPhotos && photos.length === 0 && (
                <div className="text-outline py-12 text-center">Loading photos…</div>
              )}
              {!loadingPhotos && photos.length === 0 && (
                <div className="text-outline py-12 text-center">No photos for this person.</div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    data-testid="person-photo"
                    onClick={() => setOpenPhoto(photo.id)}
                    className="group relative rounded-xl overflow-hidden bg-surface-container border border-outline-variant aspect-square cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-primary/40"
                  >
                    <ImgWithFallback
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      sources={thumbSources(photo.id, photo.drive_file_id)}
                      alt={photo.path}
                      placeholder={photoPlaceholder}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5">
                      <p className="text-[12px] font-mono font-medium text-white truncate">{basename(photo.path)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {photos.length > 0 && (
                <div className="pt-space-md flex items-center justify-between text-body-sm font-body-sm text-outline border-t border-outline-variant">
                  <span>Showing {photos.length} tagged {photos.length === 1 ? "image" : "images"}</span>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {(() => {
        const pid = photos.map((p) => p.id);
        const idx = openPhoto != null ? pid.indexOf(openPhoto) : -1;
        if (idx < 0) return null;
        return (
          <Lightbox
            ids={pid}
            index={idx}
            onIndexChange={(i) => setOpenPhoto(pid[i] ?? null)}
            onClose={() => setOpenPhoto(null)}
            driveIds={Object.fromEntries(photos.map((p) => [p.id, p.drive_file_id ?? null]))}
            onOpenPerson={
              onOpenPerson
                ? (p) => {
                    setOpenPhoto(null);
                    onOpenPerson(p);
                  }
                : undefined
            }
            onOpenSimilar={
              onOpenSimilar
                ? (p) => {
                    setOpenPhoto(null);
                    onOpenSimilar(p);
                  }
                : undefined
            }
          />
        );
      })()}
    </div>
  );
}
