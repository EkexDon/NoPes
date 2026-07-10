# 0005 — TipTap/ProseMirror as the editor engine

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

The editor is the heart of NoPes. It must offer WYSIWYG Markdown editing while persisting clean `.md` files, and support an unusually wide extension surface: WikiLinks with hover previews, slash-command templates, tables with a custom toolbar, task lists, KaTeX math, Mermaid diagrams, inline media (images/video/PDF), section folding, and typewriter mode.

## Decision Drivers

- Markdown in/out must be lossless enough that files stay clean and portable ([ADR 0002](0002-local-first-markdown-as-source-of-truth.md)).
- Deep extensibility: custom node views (Mermaid, media), decorations (folding), and suggestion popups (`[[`, `/`) must be first-class.
- React integration ([ADR 0003](0003-react-typescript-vite-frontend.md)).

## Considered Options

- **TipTap (ProseMirror) + `tiptap-markdown`**
- **Milkdown** — Markdown-first ProseMirror framework
- **CodeMirror 6** — source-mode editing with preview, not true WYSIWYG
- **Raw ProseMirror** — full control, very high implementation cost

## Decision Outcome

Chosen option: **TipTap with the `tiptap-markdown` serializer**, implemented in `src/components/NoteEditor.tsx`.

- Official extensions cover tables, task lists, links, images, placeholder, color/font; community extensions cover math (`@aarkue/tiptap-math-extension` + KaTeX).
- ProseMirror's plugin layer is used directly where React would be too slow: `FoldingExtension.ts` implements section folding as decorations with zero React re-renders.
- `@tiptap/suggestion` powers both the `[[` WikiLink autocomplete and the `/` template menu.
- **Milkdown was the original candidate** and its `@milkdown/*` packages still sit unused in `package.json`; it lost because customizing node views and toolbars fought the framework. Removing those dependencies is an open cleanup task.

### Consequences

- **Good**: Every planned editor feature landed without forking the engine; the TipTap extension model matched the product's pace.
- **Good**: Session-only state (folding) stays out of the files, keeping Markdown clean.
- **Bad**: ProseMirror lifecycle is unforgiving — destroyed-editor access caused the grey-screen crash class; every `editor.commands.*` call is now guarded by `isDestroyed` checks and `editorLifecycle.ts` (see [ADR 0012](0012-crash-resilience-strategy.md)).
- **Bad**: `NoteEditor.tsx` has grown to ~80 KB and concentrates too many concerns; extraction of node views into modules is overdue.
- **Bad**: Markdown round-tripping through a rich-text model can normalize user formatting (list markers, spacing) in edge cases.

## Related

- [ADR 0012](0012-crash-resilience-strategy.md) — consequences of this choice drove much of Phase 1 stability work.
