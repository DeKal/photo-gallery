import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { AuthProvider } from "./auth";
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

// BrowserRouter (path-based routes): the backend API lives under /api on the
// same origin, so client routes (/all, /people, /albums, …) own the root paths
// without colliding. The gateway (nginx) and Vercel both fall back to
// index.html for unknown paths, so deep links survive a reload.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </HelmetProvider>
  </StrictMode>,
);

