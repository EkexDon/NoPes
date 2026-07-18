# 0009 — Excalidraw for the infinite canvas, stored as vault files

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Visual thinking (mind maps, architecture sketches, freehand brainstorming) needs an infinite whiteboard. Building a canvas engine from scratch is a multi-year effort; embedding one raises the questions of file format, vault integration, and linking canvases to notes.

## Decision Drivers

- Ship a professional whiteboard without owning a canvas engine.
- Storage must follow the vault philosophy: open format, plain files ([ADR 0002](0002-local-first-markdown-as-source-of-truth.md)).
- Canvas elements should participate in the knowledge graph via `[[WikiLinks]]`.
- First-class React integration ([ADR 0003](0003-react-typescript-vite-frontend.md)).

## Considered Options

- **Excalidraw** (`@excalidraw/excalidraw`) — open-source, React-native, open JSON format
- **tldraw** — excellent SDK, but licensing (watermark/commercial terms) conflicts with a free local-first tool
- **Custom canvas** on konva/fabric.js — full control, enormous cost

## Decision Outcome

Chosen option: **embed Excalidraw** (`src/components/CanvasView.tsx`).

- Boards persist as `.excalidraw` JSON files **inside the vault**, debounced auto-save; they're portable to excalidraw.com and Obsidian's Excalidraw plugin.
- Text elements containing `[[WikiLinks]]` act as navigation: clicking a linked shape opens the referenced note, wiring the whiteboard into the same link graph as Markdown notes.
- The canvas is a separate view mode (`⌘D`) in both split-view panes, not embedded per-note.

### Consequences

- **Good**: A mature, battle-tested whiteboard (hand-drawn aesthetic, shape libraries, keyboard UX) for the cost of an integration layer.
- **Good**: `.excalidraw` files honor the no-lock-in promise; users can open them anywhere.
- **Bad**: Excalidraw is a heavy dependency and brings its own styling/theming system that must be reconciled with NoPes themes ([ADR 0013](0013-vanilla-css-theme-system.md)).
- **Bad**: Canvas ↔ note linking is one-directional (canvas → note); canvases don't yet appear as graph nodes or backlink sources.
- **Neutral**: Upstream API churn (`0.x` versioning) requires care on upgrades.

## Related

- [ADR 0002](0002-local-first-markdown-as-source-of-truth.md) — open file formats in the vault.
