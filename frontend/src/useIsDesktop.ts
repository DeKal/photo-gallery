import { useEffect, useState } from "react";

// True when the viewport is at least Tailwind's `md` breakpoint (768px).
// Curation actions (select/merge, hide) are desktop-only, so components use
// this to render them conditionally rather than merely hiding with CSS.
export function useIsDesktop(): boolean {
  const query = "(min-width: 768px)";
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}
