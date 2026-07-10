# 0010 — Version history via shadow snapshots, deliberately not git

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

"Never lose a thought": users need protection against destructive edits and deletions, with browsable per-note history and one-click restore. Git is the obvious versioning tool — but vaults are user-owned folders that are often *already* git repositories, and a tool silently managing a nested repo inside user data is a trust hazard.

## Decision Drivers

- Zero-configuration safety net; users must not need to know git exists.
- Must not conflict with users' own git/Dropbox/iCloud sync of the vault.
- Bounded disk usage over years of edits.
- History operations must never be able to break saving.

## Considered Options

- **Shadow-copy snapshots** in `<vault>/.nopes/history/<key>/<timestamp>.md`
- **git (libgit2/CLI)** in the vault or a hidden nested repo
- **Append-only diff log** per note (storage-efficient, complex restore)

## Decision Outcome

Chosen option: **shadow-copy snapshots**, implemented in `src/history.ts`.

- Every save first preserves the pre-save on-disk state, rate-limited to one snapshot per minute per note (`SNAPSHOT_MIN_INTERVAL_MS`); deletions and restores force-snapshot first, so no operation can lose data.
- **Pruning policy** (`planPruning`): keep everything < 1 h, one per hour for a day, one per day for a month, one per ISO-week forever — history thins out but never fully vanishes.
- Snapshot directories are keyed by slug + djb2 hash (`historyKeyFor`), and `moveHistory` migrates them on rename/move.
- The whole module is fail-soft: `maybeSnapshotNote` never throws; a broken history layer degrades to "no snapshots", never to "no saves".
- Pure logic (naming, stamp parsing, pruning) is separated from the filesystem layer and covered by 17 tests (`history.test.ts`); the UI is `HistoryModal.tsx` with an LCS line-diff (`diff.ts`).

### Consequences

- **Good**: Dumb, predictable, inspectable — snapshots are plain `.md` files a user can read or rescue by hand.
- **Good**: No interference with user-managed git repos; `.nopes/` is one gitignore line away.
- **Bad**: Full-file copies cost more disk than diffs; the pruning policy is the counterweight.
- **Bad**: No branching/merging semantics — this is a safety net, not version control, and should stay that way.
- **Neutral**: Snapshot granularity (1/min) means very rapid successive edits share one snapshot; `force` covers the critical paths.

## Related

- [ADR 0002](0002-local-first-markdown-as-source-of-truth.md) — history data also lives as plain files in the vault.
- [ADR 0014](0014-vitest-testing-strategy.md) — pure-core extraction pattern.
