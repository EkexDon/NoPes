# Architecture Decision Records (ADRs)

This directory documents the significant architectural decisions made in **NoPes**. Each record follows the [MADR](https://adr.github.io/madr/) template: context, decision drivers, considered options, decision outcome, and consequences.

These ADRs were written retroactively (July 2026) to capture decisions already shipped in the codebase. New decisions should get a new record; superseded decisions should be marked as such, never deleted.

## How to add an ADR

1. Copy the structure of an existing record.
2. Number it sequentially (`NNNN-short-title.md`).
3. Set status to `proposed`, flip to `accepted` once implemented.
4. Add it to the index below.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](0001-use-tauri-instead-of-electron.md) | Use Tauri 2.0 instead of Electron for the desktop shell | accepted | 2026-07 |
| [0002](0002-local-first-markdown-as-source-of-truth.md) | Local-first: plain Markdown files as the single source of truth | accepted | 2026-07 |
| [0003](0003-react-typescript-vite-frontend.md) | React 19 + TypeScript + Vite for the frontend | accepted | 2026-07 |
| [0004](0004-zustand-single-global-store.md) | Zustand as the single global state store | accepted | 2026-07 |
| [0005](0005-tiptap-prosemirror-editor-engine.md) | TipTap/ProseMirror as the editor engine | accepted | 2026-07 |
| [0006](0006-markdown-backed-kanban.md) | Markdown-backed Kanban board (no proprietary format) | accepted | 2026-07 |
| [0007](0007-local-ai-via-ollama-sidecar.md) | Local AI via an Ollama sidecar process managed by the Rust backend | accepted | 2026-07 |
| [0008](0008-ai-embeddings-in-web-worker.md) | AI embeddings in a Web Worker with idle-timeout termination | accepted | 2026-07 |
| [0009](0009-excalidraw-for-infinite-canvas.md) | Excalidraw for the infinite canvas, stored as vault files | accepted | 2026-07 |
| [0010](0010-version-history-via-shadow-snapshots.md) | Version history via shadow snapshots, deliberately not git | accepted | 2026-07 |
| [0011](0011-quick-capture-second-window.md) | Quick Capture as a second frameless window decoupled from the main store | accepted | 2026-07 |
| [0012](0012-crash-resilience-strategy.md) | Layered crash resilience: JS handlers, ErrorBoundary retry, Rust panic logger | accepted | 2026-07 |
| [0013](0013-vanilla-css-theme-system.md) | Vanilla CSS with a token-based theme system instead of a CSS framework | accepted | 2026-07 |
| [0014](0014-vitest-testing-strategy.md) | Vitest + Testing Library with pure-core extraction for testability | accepted | 2026-07 |

## Related ADRs

- 0002 ↔ 0006, 0010 — the "files are the database" philosophy drives both the Kanban format and history design.
- 0007 ↔ 0008 — text generation (Ollama, native process) and embeddings (transformers.js, Web Worker) are deliberately separate systems.
- 0001 ↔ 0011, 0012 — the Tauri shell enables the tray/second-window architecture and requires the dual JS/Rust crash strategy.
