import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickCapture } from "./components/QuickCapture";
import { isValidTheme, applyThemeToDom } from "./themes";
import "./theme.css";
import "./index.css";

/* This bundle serves two windows. The main window mounts the full app;
   the "capture" window mounts only the Quick Capture input. */
const windowLabel = (() => {
  try {
    if ('__TAURI_INTERNALS__' in window) {
      return (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? 'main';
    }
  } catch { /* not in Tauri */ }
  return 'main';
})();

if (windowLabel === 'capture') {
  // The store isn't loaded in this window — apply the theme directly.
  const stored = localStorage.getItem('nopes_theme');
  if (isValidTheme(stored)) applyThemeToDom(stored);
  // The window itself is transparent; only the capture card paints.
  document.documentElement.classList.add('capture-window');
}

/* ─── Global Error Handlers (Grey-Screen Prevention) ─────────── */
window.addEventListener('error', (e) => {
  console.error('[NoPes:GlobalError]', e.error?.stack || e.message);
  // If the root element has gone blank, try a full reload as last resort
  const root = document.getElementById('root');
  if (root && root.childElementCount === 0) {
    console.warn('[NoPes] Detected blank root — scheduling recovery reload.');
    setTimeout(() => window.location.reload(), 2000);
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[NoPes:UnhandledRejection]', e.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {windowLabel === 'capture' ? <QuickCapture /> : <App />}
  </React.StrictMode>,
);
