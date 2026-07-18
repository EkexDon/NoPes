# 0003 — React 19 + TypeScript + Vite for the frontend

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

The UI inside the Tauri webview needs a framework and build toolchain. The app is UI-heavy: a rich-text editor, force-directed graph, kanban board, infinite canvas, command palette, and split-view layout all live in one window.

## Decision Drivers

- Ecosystem fit: the chosen editor (TipTap), canvas (Excalidraw), graph (react-force-graph-2d), and command palette (kbar) all ship first-class React bindings.
- Type safety across a large store and many component boundaries.
- Fast dev loop inside `tauri dev`.

## Considered Options

- **React 19 + TypeScript + Vite**
- **Svelte/SvelteKit** — smaller runtime, but weaker bindings for Excalidraw/TipTap
- **Vanilla TS + ProseMirror directly** — maximal control, maximal cost

## Decision Outcome

Chosen option: **React 19 + TypeScript + Vite**.

- Vite serves the dev build to the Tauri webview and produces the production bundle (`vite.config.ts`); Vitest reuses the same pipeline ([ADR 0014](0014-vitest-testing-strategy.md)).
- One bundle serves **two windows**: `src/main.tsx` inspects the Tauri window label and mounts either the full `App` or only `QuickCapture` ([ADR 0011](0011-quick-capture-second-window.md)).
- React Strict Mode is enabled deliberately — it surfaced real editor-lifecycle bugs (double-destroy) that were then fixed properly (`editorLifecycle.ts`, see [ADR 0012](0012-crash-resilience-strategy.md)).

### Consequences

- **Good**: Every major third-party surface (Excalidraw, TipTap, kbar, force-graph) integrates without adapter layers.
- **Good**: TypeScript catches store/component contract drift in a codebase where `useStore.ts` alone defines dozens of actions.
- **Bad**: React re-render discipline matters in hot paths; the folding feature was explicitly built as a ProseMirror decoration plugin to bypass React re-renders (`src/extensions/FoldingExtension.ts`).
- **Bad**: Strict Mode's double-invoked effects require idempotent cleanup everywhere (editor destroy guards, tippy delegate teardown).

## Related

- [ADR 0004](0004-zustand-single-global-store.md), [ADR 0005](0005-tiptap-prosemirror-editor-engine.md).
