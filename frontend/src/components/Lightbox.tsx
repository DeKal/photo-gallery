import { useEffect } from "react";

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
  // Optional action button (e.g. "More like this") shown over the image.
  actionLabel?: string;
  onAction?: () => void;
}

// Full-screen overlay showing a single image at full resolution. Click the
// backdrop or press Escape to dismiss.
export default function Lightbox({
  src,
  alt,
  onClose,
  actionLabel,
  onAction,
}: Props) {
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
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox-img" src={src} alt={alt ?? ""} />
        {actionLabel && onAction && (
          <button
            className="primary lightbox-action"
            data-testid="lightbox-action"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
