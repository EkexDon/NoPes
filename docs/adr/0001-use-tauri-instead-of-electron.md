# 0001 — Use Tauri 2.0 instead of Electron for the desktop shell

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

NoPes is a local-first knowledge management desktop app whose selling points are **speed, low memory footprint, and privacy**. It needs native filesystem access to the user's vault, the ability to spawn and supervise a local AI process (Ollama), a system tray icon, global shortcuts, and native dialogs. Which desktop shell should host the web-based UI?

## Decision Drivers

- Memory footprint is a headline feature ("High-Performance Second Brain"); the app even ships a live memory monitor (`get_system_stats` in `src-tauri/src/lib.rs`).
- Need for OS-level capabilities: process spawning/supervision, tray icon, global shortcut (⌥Space), multiple windows.
- Small distributable size for the macOS `.dmg`.
- Security: a capability-based permission model fits the privacy-first positioning.

## Considered Options

- **Tauri 2.0** — Rust backend + OS webview (WKWebView on macOS)
- **Electron** — Node.js backend + bundled Chromium
- **Pure web app (PWA)** — no native shell

## Decision Outcome

Chosen option: **Tauri 2.0**.

- The Rust backend hosts custom commands (`ensure_model`, `manage_ollama`, `get_system_stats`) and supervises the Ollama child process, including cleanup on `Destroyed`/`CloseRequested` window events.
- Official plugins cover the needed OS surface: `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-notification`, `tauri-plugin-global-shortcut`, plus the built-in `tray-icon` feature.
- Frontend/backend contract stays small: three `#[tauri::command]`s plus plugin APIs, so nearly all product logic lives in TypeScript.
- A PWA was ruled out immediately: no reliable full-disk vault access, no child processes, no tray.

### Consequences

- **Good**: RAM usage of the shell is a fraction of Electron's; the bundled app is small; Rust gives memory-safe process supervision.
- **Good**: The capability system (`src-tauri/capabilities/`) makes the filesystem surface explicit and auditable.
- **Bad**: Tied to WKWebView quirks on macOS (Safari-engine CSS/JS differences vs Chromium); testing must cover the webview actually shipped.
- **Bad**: Windows/Linux builds need separate validation of webview behavior and Ollama path detection (tracked in ROADMAP Phase 2).
- **Bad**: Rust panics don't surface in the web console — this forced a dedicated panic logger (see [ADR 0012](0012-crash-resilience-strategy.md)).

## Related

- [ADR 0007](0007-local-ai-via-ollama-sidecar.md) — Ollama sidecar depends on native process control.
- [ADR 0011](0011-quick-capture-second-window.md) — second window + tray + global shortcut are Tauri features.
