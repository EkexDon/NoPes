# 0002 — Local-first: plain Markdown files as the single source of truth

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Where does NoPes store the user's knowledge? A knowledge management tool must decide between an internal database (fast queries, rich metadata) and plain files on disk (portability, user ownership). This decision shapes every feature: search, graph, kanban, history, sync.

## Decision Drivers

- **Privacy-first positioning**: "Your data never leaves your machine."
- **No lock-in**: users must be able to open their vault with any editor, sync it with git/Dropbox, or migrate to/from Obsidian.
- **Durability**: notes must outlive the app.
- Interoperability with the existing Markdown ecosystem (WikiLinks, `.excalidraw`, `.docx` import via mammoth/turndown).

## Considered Options

- **Plain `.md` files in a user-chosen vault folder** — filesystem is the database
- **SQLite database** with export/import
- **Hybrid**: files + SQLite index/cache

## Decision Outcome

Chosen option: **plain `.md` files in a user-chosen vault folder**.

- The vault is scanned recursively (`scanDir` in `src/store/useStore.ts`) with depth/entry caps and symlink-cycle protection; the file tree in the Sidebar mirrors the disk directly.
- All derived structures are computed in memory at runtime: the graph (`vaultIndex.ts` parses `[[WikiLinks]]`), backlinks/unlinked mentions (`mentions.ts`), and the Kanban board ([ADR 0006](0006-markdown-backed-kanban.md)).
- App-internal data lives in a `.nopes/` folder inside the vault (history snapshots) or in `localStorage` (theme, favorites) — never in an opaque database.
- Non-markdown content keeps open formats too: whiteboards are `.excalidraw` JSON ([ADR 0009](0009-excalidraw-for-infinite-canvas.md)).

### Consequences

- **Good**: Zero lock-in; vaults are git-friendly, Obsidian-compatible in spirit, and survive the app's death.
- **Good**: Two-way sync between views (Editor ↔ Kanban) is trivially correct because both read/write the same file.
- **Bad**: No indexed queries — search, graph building, and mention scanning are O(vault size) and require caps/debouncing (e.g., unlinked mentions capped at 500 files).
- **Bad**: Concurrent external edits can race with in-app saves; mitigated by version snapshots ([ADR 0010](0010-version-history-via-shadow-snapshots.md)).
- **Neutral**: Full-vault features (semantic search, ROADMAP Phase 3) will likely need an on-disk index eventually — that index must remain a disposable cache, not a source of truth.

## Related

- [ADR 0006](0006-markdown-backed-kanban.md), [ADR 0010](0010-version-history-via-shadow-snapshots.md) — direct applications of this philosophy.
