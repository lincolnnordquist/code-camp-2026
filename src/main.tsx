import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./shared/ui/tokens.css";
import "./shared/ui/bundle.css";
// The self-hosted typefaces and the attendee app's base styles build on the design system above.
import "./fonts.css";
import "./index.css";
// After the styles, so each screen's own CSS comes later in the cascade than the base it builds on.
import App from "./App";
import { installInputModality } from "./shell/inputModality";
import { installPopTransitions } from "./shell/navTransitions";

// Production only: in development a cached copy would hide live edits.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Without the worker the app still works online; it just will not open offline.
    });
  });
}

// The shell restores each screen's scroll itself (src/shell/scrollRestoration.ts); the browser's own would fight it.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
// Before the router subscribes, so Back and Forward can be animated (see installPopTransitions).
installPopTransitions();
// Marks pointer or keyboard input on <html> for quiet focus returns.
installInputModality();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
