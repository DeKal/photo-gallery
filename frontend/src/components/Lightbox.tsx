import { useEffect } from "react";

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

// Full-screen overlay showing a single image at full resolution. Click the
// backdrop or press Escape to dismiss.
export default function Lightbox({ src, alt, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose} data-testid="lightbox">
      <button className="lightbox-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <img
        className="lightbox-img"
        src={src}
        alt={alt ?? ""}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
