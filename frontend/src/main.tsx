import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Icon fonts render their ligature NAME as plain text until the font loads
// (FOUT). Keep Material Symbols glyphs hidden until the font is ready, with a
// timeout fallback so icons never stay invisible if loading fails.
function revealIcons() {
  document.documentElement.classList.add("fonts-ready");
}
if (document.fonts && "ready" in document.fonts) {
  document.fonts.ready.then(revealIcons);
}
setTimeout(revealIcons, 3000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

