import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

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
    <App />
  </React.StrictMode>,
);
