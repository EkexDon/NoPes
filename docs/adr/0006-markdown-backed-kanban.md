# 0006 — Markdown-backed Kanban board (no proprietary format)

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

NoPes offers a Kanban view for task management. Where does the board's data live? A dedicated board format (JSON, database) allows richer metadata (colors, assignees, ordering), but breaks the "plain files" promise and forks the user's tasks away from their notes.

## Decision Drivers

- Consistency with [ADR 0002](0002-local-first-markdown-as-source-of-truth.md): no proprietary formats.
- Two-way sync: a task edited in the note editor must appear on the board, and vice versa.
- Any existing note with checklists should "just become" a board — zero migration.

## Considered Options

- **Interpret standard Markdown structure**: `##` headings = columns, `- [ ]` items = cards
- **Sidecar JSON board file** referencing note lines
- **Front-matter metadata** encoding board layout inside the note

## Decision Outcome

Chosen option: **interpret standard Markdown structure** (`src/components/KanbanView.tsx`).

- `##` headings become columns; `- [ ]` / `- [x]` checklist items become cards.
- Loose checklist items with no preceding `##` heading are gathered into a default "📋 Tasks" column, so unstructured notes still render.
- Drag & drop and inline card creation rewrite the underlying Markdown and save it back to the `.md` file — the board is a pure projection.
- The editor and the Kanban view read the same file, so sync is inherent rather than implemented.

### Consequences

- **Good**: Every board is readable and editable in any Markdown editor; boards work in Obsidian, GitHub previews, etc.
- **Good**: No migration, no schema versioning, no orphaned board metadata.
- **Bad**: Card metadata is capped at what checklist syntax can express — no colors, due dates, or assignees without inventing syntax.
- **Bad**: Parsing/serializing Markdown on every drag is more fragile than mutating a data model; regressions are covered by tests.
- **Neutral**: Cross-note boards (one board over many files) don't fit this model and would need a query layer.

## Related

- [ADR 0002](0002-local-first-markdown-as-source-of-truth.md) — the governing philosophy.
