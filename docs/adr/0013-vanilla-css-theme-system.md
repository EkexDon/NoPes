# 0013 — Vanilla CSS with a token-based theme system instead of a CSS framework

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

The UI needs a premium, cohesive visual identity across very different surfaces: a prose editor, a canvas-rendered graph, Excalidraw, Mermaid diagrams, KaTeX output, and standard chrome (sidebar, tabs, modals). It also ships six user-selectable themes. Should styling use a utility framework (Tailwind), CSS-in-JS, or plain CSS?

## Decision Drivers

- Third-party render targets (force-graph canvas, Mermaid SVG, Excalidraw, KaTeX) can't consume utility classes — they need raw color values at runtime.
- Theming must switch instantly, app-wide, including the store-less capture window ([ADR 0011](0011-quick-capture-second-window.md)).
- Typographic control over rendered Markdown matters more than component-styling speed.
- No runtime styling cost in hot paths (editor keystrokes).

## Considered Options

- **Vanilla CSS with custom-property design tokens** + a small TS theme registry
- **Tailwind CSS** — fast for chrome, awkward for prose and canvas consumers
- **CSS-in-JS** (styled-components/emotion) — runtime cost, poor fit for ProseMirror-generated DOM

## Decision Outcome

Chosen option: **vanilla CSS with design tokens**, split across `src/theme.css` (tokens per theme), `src/index.css` (all component styles), and `src/themes.ts` (registry).

- Themes are `[data-theme]` attribute scopes on `<html>`; `obsidian` (dark) is the `:root` default. Six themes ship: Obsidian, Midnight, Forest, Rosewood, Paper, Snow — each defined purely as token overrides.
- `applyThemeToDom` flips one attribute; every surface using `var(--token)` retints instantly with zero re-renders.
- `cssToken()` reads resolved token values off `<html>` for JS/canvas consumers (GraphView, Mermaid config) that can't use `var()` directly — one bridge for all non-CSS renderers.
- The capture window applies the persisted theme straight from `localStorage`, needing no store.

### Consequences

- **Good**: One token vocabulary drives CSS, canvas, and SVG surfaces; adding theme #7 is a block of custom properties, no component changes.
- **Good**: Zero styling runtime; ProseMirror's generated DOM is styled by plain selectors, which is the natural grain for prose.
- **Bad**: `index.css` has grown to ~95 KB in a single file; it needs splitting by feature before it becomes unmaintainable.
- **Bad**: No utility classes means spacing/layout consistency is by convention; drift is possible without a linter.
- **Neutral**: Community themes (ROADMAP Phase 4) map naturally onto the token system.

## Related

- [ADR 0011](0011-quick-capture-second-window.md) — store-less theming requirement.
