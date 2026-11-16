import { useEffect, useState } from "react";
import {
  getPersonPhotos,
  renamePerson,
  thumbUrl,
  type Photo,
} from "../api";

interface Props {
  personId: number;
  onBack: () => void;
  // Notify the parent list so it can re-fetch names/counts.
  onChanged: () => void;
}

export default function PersonDetail({ personId, onBack, onChanged }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    getPersonPhotos(personId)
      .then((p) => {
        setPhotos(p);
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

  return (
    <div>
      <div className="detail-header">
        <button onClick={onBack}>← Back</button>
        <input
          type="text"
          placeholder="Name this person"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && !saving) void save();
          }}
        />
        <button
          className="primary"
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

      {error && <div className="error-text">{error}</div>}
      {loading && <div className="loading">Loading photos…</div>}
      {!loading && photos.length === 0 && (
        <div className="empty">No photos for this person.</div>
      )}

      <div className="grid">
        {photos.map((photo) => (
          <img
            key={photo.id}
            className="thumb"
            src={thumbUrl(photo.id)}
            alt={photo.path}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}
