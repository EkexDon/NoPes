# 0011 — Quick Capture as a second frameless window decoupled from the main store

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Quick Capture (⌥Space from anywhere) must summon an input instantly, even while the main window is buried or busy. Reusing the main window (focus + modal) is slow and disruptive; a second webview window raises the question of how two windows share state safely.

## Decision Drivers

- Capture latency: the window must appear instantly, regardless of main-window state.
- Isolation: a crash or busy editor in the main window must not block capturing a thought.
- Avoid multi-window state synchronization complexity entirely.

## Considered Options

- **Second frameless Tauri window** with **no shared store**, communicating via filesystem + events
- **Reuse the main window** — show/focus and open a modal
- **Second window sharing the Zustand store** via event-based sync

## Decision Outcome

Chosen option: **an isolated `capture` window** (`src/components/QuickCapture.tsx`, window handling in `src-tauri/src/lib.rs`).

- One bundle, two mounts: `src/main.tsx` checks the Tauri window label and mounts only `QuickCapture` for the capture window — the Zustand store, vault scan, and editor are never loaded there.
- The window is transparent, frameless, skip-taskbar, always-on-top; "closing" it only hides it (`api.prevent_close()`), so reopening is instant.
- ⌥Space is registered via `tauri-plugin-global-shortcut` with graceful fallback (another app may own it); a tray icon (`TrayIconBuilder`) provides Open / Quick Capture / Quit as an alternative entry point.
- **Communication is filesystem-first**: the capture window appends under a `## 📥 Captures` section in today's `YYYY-MM-DD.md` daily note (pure formatter in `src/captures.ts`, 9 tests), then emits a `nopes:capture-saved` event the main window consumes to refresh. The file, not the event, is the truth — consistent with [ADR 0002](0002-local-first-markdown-as-source-of-truth.md).
- Window lifecycle asymmetry is explicit: only the **main** window's destruction stops Ollama and exits the app; otherwise the hidden capture window would keep the process alive forever.

### Consequences

- **Good**: Capture works even when the main window is wedged; no store-sync bugs can exist because there is no store sync.
- **Good**: The daily-note append convention means captures are ordinary Markdown, visible in Journal and Editor immediately.
- **Bad**: The capture window duplicates a sliver of logic (theme application from `localStorage`) since it can't use the store.
- **Bad**: Global-shortcut conflicts are silently non-fatal — discoverability depends on the tray menu.
- **Neutral**: Launch-at-login is a known follow-up; capture currently requires NoPes to be running.

## Related

- [ADR 0001](0001-use-tauri-instead-of-electron.md) — tray, global shortcut, and multi-window are Tauri capabilities.
- [ADR 0004](0004-zustand-single-global-store.md) — the store deliberately stays single-window.
