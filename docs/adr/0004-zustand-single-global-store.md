# 0004 — Zustand as the single global state store

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Many features share state: the vault file tree, open tabs and their contents, the active view mode per pane (editor/graph/journal/canvas/kanban), split-view layout, favorites, journal streaks, graph data, and pending media inserts. Components as distant as `Sidebar`, `CommandBar`, and `NoteEditor` all read and mutate this state. How should it be managed?

## Decision Drivers

- Cross-cutting state (tabs, vault path, view modes) touched by nearly every component.
- Actions with async filesystem side effects (open note → read file → update tab content) belong next to the state they mutate.
- Minimal boilerplate; selector-based subscriptions to avoid re-render storms.

## Considered Options

- **Zustand** — single store, plain functions as actions
- **Redux Toolkit** — more structure, more ceremony
- **React Context + useReducer** — no dependency, but re-render and composition problems at this scale
- **Jotai/Recoil** — atomic model; poor fit for the "one vault, one session" shape

## Decision Outcome

Chosen option: **Zustand**, with a **single store** in `src/store/useStore.ts`.

- The store holds both state and async actions; Tauri fs calls (`readTextFile`, `writeTextFile`, `readDir`, …) happen directly inside actions.
- Components subscribe via selectors, so e.g. the Sidebar doesn't re-render on tab-content keystrokes.
- Session state that must survive restarts (theme, favorites) goes to `localStorage`; everything else is rebuilt from the filesystem on launch, consistent with [ADR 0002](0002-local-first-markdown-as-source-of-truth.md).
- The Quick Capture window deliberately does **not** load this store ([ADR 0011](0011-quick-capture-second-window.md)).

### Consequences

- **Good**: One import gives any component access to any state/action; no provider pyramids.
- **Good**: Async actions are testable as plain functions.
- **Bad**: `useStore.ts` is a ~800-line God-module and keeps growing; feature-sliced stores (or Zustand slices) will be needed if it doubles again.
- **Bad**: A single store makes accidental broad subscriptions easy; selector discipline is by convention, not enforced.

## Related

- [ADR 0002](0002-local-first-markdown-as-source-of-truth.md) — the store is a runtime cache over the filesystem, never the source of truth.
