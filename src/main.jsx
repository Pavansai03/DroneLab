import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { consumeSessionHandoff } from "./lib/sessionHandoff.js";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
const render = () =>
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );

/**
 * Apply a session handed over from the portal BEFORE the first render.
 *
 * Doing it inside a component would mean the app mounts signed out, briefly
 * shows the sign-in form, and then swaps to the signed-in view — a flash of the
 * exact screen this feature exists to prevent. Waiting here costs a few
 * milliseconds and only when a handoff is actually present.
 *
 * It never rejects: an expired or malformed handoff resolves false and the
 * student simply lands signed out, which is what would have happened anyway.
 */
consumeSessionHandoff().finally(render);
