import { useState, type ReactNode } from "react";

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

  if (sources.length === 0 || idx >= sources.length) {
    return <>{placeholder}</>;
  }

  return (
    <img
      className={className}
      src={sources[idx]}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setIdx((i) => i + 1)}
      {...rest}
    />
  );
}
