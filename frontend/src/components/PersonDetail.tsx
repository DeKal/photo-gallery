import { useEffect, useState } from "react";
import {
  getPerson,
  getPersonPhotos,
  renamePerson,
  faceThumbUrl,
  thumbUrl,
  imageUrl,
  type Person,
  type Photo,
} from "../api";
import ImgWithFallback from "./ImgWithFallback";
import Lightbox from "./Lightbox";

interface Props {
  personId: number;
  onBack: () => void;
  // Notify the parent list so it can re-fetch names/counts.
  onChanged: () => void;
}

const facePlaceholder = (
  <div className="thumb thumb-placeholder" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
    </svg>
  </div>
);

const photoPlaceholder = (
  <div className="thumb thumb-placeholder" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

export default function PersonDetail({ personId, onBack, onChanged }: Props) {
  const [person, setPerson] = useState<Person | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getPerson(personId), getPersonPhotos(personId)])
      .then(([p, ph]) => {
        setPerson(p);
        setPhotos(ph);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [personId]);

  async function save() {
    setSaving(true);
    try {
      await renamePerson(personId, name.trim());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const coverSources =
    person?.cover_face_id != null ? [faceThumbUrl(person.cover_face_id)] : [];

  return (
    <div>
      <div className="detail-header">
        <button onClick={onBack}>← Back</button>
        <input
          type="text"
          placeholder="Name this person"
          data-testid="person-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && !saving) void save();
          }}
        />
        <button
          className="primary"
          data-testid="person-save-btn"
          onClick={() => void save()}
          disabled={saving || !name.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {/*
          Face-level split/move needs individual face ids, but the
          /persons/{id}/photos endpoint returns photos, not faces. Expose a
          disabled placeholder rather than faking the behavior.
        */}
        <button
          disabled
          title="needs face-level selection (future)"
        >
          Move / Split…
        </button>
      </div>

      {person && (
        <div className="person-hero">
          <div className="person-hero-face">
            <ImgWithFallback
              className="thumb"
              sources={coverSources}
              alt={person.name ?? "Unnamed"}
              placeholder={facePlaceholder}
            />
          </div>
          <div className="person-hero-meta">
            <div className="person-hero-name">{person.name ?? "Unnamed"}</div>
            <div className="person-hero-sub">
              {person.face_count}{" "}
              {person.face_count === 1 ? "face" : "faces"} ·{" "}
              {photos.length} {photos.length === 1 ? "photo" : "photos"}
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
      {loading && <div className="loading">Loading photos…</div>}
      {!loading && photos.length === 0 && (
        <div className="empty">No photos for this person.</div>
      )}

      <div className="grid">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="photo-tile"
            data-testid="person-photo"
            onClick={() => setLightbox(photo.id)}
          >
            <ImgWithFallback
              className="thumb"
              sources={[thumbUrl(photo.id)]}
              alt={photo.path}
              placeholder={photoPlaceholder}
            />
          </div>
        ))}
      </div>

      {lightbox != null && (
        <Lightbox
          src={imageUrl(lightbox)}
          alt={`Photo ${lightbox}`}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
