import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Web fonts cause FOUT: Material Symbols render their ligature NAME as text, and
// body/headline text shows a fallback then swaps to Inter/Space Grotesk. Hold the
// app (and icons) hidden until the fonts resolve, with a timeout fallback so
// nothing stays invisible if loading fails.
function revealFonts() {
  document.documentElement.classList.add("fonts-ready");
}
if (document.fonts && "ready" in document.fonts) {
  document.fonts.ready.then(revealFonts);
}
setTimeout(revealFonts, 3000);

// HashRouter (not BrowserRouter): the backend API owns root paths (/photos,
// /albums, /persons, …) behind the same nginx origin, so client routes live
// after the `#` to avoid colliding with them — and deep links survive a reload
// with no server rewrite rules.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

