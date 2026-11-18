import { useSearchParams } from "react-router-dom";

// The photo id currently open in the lightbox, mirrored to the `?photo` query so
// the open photo is part of the shareable (hash) URL. Returns the id (or null)
// and a setter that writes/clears the param with replace — paging through the
// lightbox shouldn't spam browser history.
export function usePhotoParam(): [number | null, (id: number | null) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("photo");
  const id = raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
  const setId = (next: number | null) => {
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next == null) n.delete("photo");
        else n.set("photo", String(next));
        return n;
      },
      { replace: true },
    );
  };
  return [id, setId];
}
