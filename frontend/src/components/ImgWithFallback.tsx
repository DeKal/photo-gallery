import { useEffect, useRef, useState, type ReactNode } from "react";

// How many times to retry the whole source list after every candidate has
// failed, before giving up and showing the placeholder.
const MAX_RETRIES = 4;

interface Props {
  // Candidate URLs tried in order; the first that loads wins. On error the
  // next is tried, and when all fail the placeholder is shown instead. This
  // makes a failed/reset image (e.g. a dropped connection under a burst of
  // concurrent requests) degrade gracefully instead of showing a broken icon.
  sources: string[];
  alt: string;
  className?: string;
  placeholder: ReactNode;
  "data-testid"?: string;
}

export default function ImgWithFallback({
  sources,
  alt,
  className,
  placeholder,
  ...rest
}: Props) {
  const [idx, setIdx] = useState(0);
  // Retry cycle count. Google Drive rate-limits (HTTP 429) image loads under a
  // burst, which surfaces as onError. Rather than fall straight to the
  // placeholder, back off and retry the whole candidate list a few times — the
  // 429 clears within a second or two, so the image eventually appears.
  const [retry, setRetry] = useState(0);
  const [dead, setDead] = useState(false);
  const timer = useRef<number | null>(null);

  // Reset when the candidate list changes (new photo rendered into this slot).
  const key = sources.join("|");
  useEffect(() => {
    setIdx(0);
    setRetry(0);
    setDead(false);
  }, [key]);

  // Drop any pending retry timer on unmount.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (sources.length === 0 || dead) {
    return <>{placeholder}</>;
  }

  const base = sources[idx];
  // Cache-bust on retry so the browser re-requests instead of replaying the
  // cached 429/error response.
  const src =
    retry > 0 ? `${base}${base.includes("?") ? "&" : "?"}retry=${retry}` : base;

  const onError = () => {
    if (idx < sources.length - 1) {
      setIdx((i) => i + 1); // try the next candidate (e.g. local/thumb fallback)
      return;
    }
    if (retry < MAX_RETRIES) {
      // Exponential backoff with jitter: 0.5s, 1s, 2s, 4s (+ up to 0.4s).
      const delay = Math.min(8000, 500 * 2 ** retry) + Math.random() * 400;
      timer.current = window.setTimeout(() => {
        setRetry((r) => r + 1);
        setIdx(0);
      }, delay);
    } else {
      setDead(true);
    }
  };

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={onError}
      {...rest}
    />
  );
}
