import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { i18nReady } from "./i18n";
import { logStartupEvent } from "./lib/tauri";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";

await i18nReady;
if ("__TAURI_INTERNALS__" in window) {
  logStartupEvent("i18n_ready", performance.now()).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
if ("__TAURI_INTERNALS__" in window) {
  logStartupEvent("root_rendered", performance.now()).catch(() => {});
}
