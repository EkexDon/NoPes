# 0014 — Vitest + Testing Library with pure-core extraction for testability

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Most of NoPes's logic runs against Tauri APIs (filesystem, path, windows) that don't exist in a test runner, and against a ProseMirror editor with a complex lifecycle. How do we get meaningful automated coverage without booting a full Tauri app per test?

## Decision Drivers

- Tests must run headless and fast (`npm test`) without a Tauri runtime.
- The riskiest logic — snapshot pruning, capture formatting, mention masking, diffing, kanban parsing — is algorithmic, not UI.
- Regression protection for the crash-class fixes ([ADR 0012](0012-crash-resilience-strategy.md)) must survive refactors.

## Considered Options

- **Vitest + jsdom + Testing Library**, with **pure logic extracted from IO layers**
- **Jest** — equivalent capability, but a second toolchain next to Vite
- **E2E via WebDriver/tauri-driver** — highest fidelity, too slow and brittle as the base layer

## Decision Outcome

Chosen option: **Vitest** (`vitest.config.ts`, jsdom environment, `vitest.setup.ts`), sharing the Vite pipeline ([ADR 0003](0003-react-typescript-vite-frontend.md)).

- **Pure-core extraction is the architectural rule that makes this work**: modules separate deterministic logic from Tauri IO so the logic imports cleanly in tests. Examples:
  - `history.ts` — naming, stamp round-trips, `planPruning` buckets (17 tests) vs. the fs layer below.
  - `captures.ts` — daily-note append formatting (9 tests).
  - `mentions.ts` — word-boundary matching with code/wikilink masking (14 tests).
  - `diff.ts` — the LCS line-diff engine.
- Editor-lifecycle regressions are covered with mocks: `noteeditor-destroy.test.ts` (double-destroy, null safety, destroy() errors) and `phase1-integration.test.ts` (timer/tippy cleanup, sync guards, WikiLink regex safety).
- The suite grew from 16 to 31+ tests across `src/__tests__/`; new pure modules ship with their tests (see ROADMAP checkmarks).

### Consequences

- **Good**: The most failure-prone algorithms are locked down; refactors of the fs/UI layers can't silently break pruning or capture formatting.
- **Good**: Zero-config speed — the same Vite transforms serve dev, build, and test.
- **Bad**: Tauri APIs are mocked, so integration behavior (real fs races, real window events) is untested; a thin E2E layer remains future work.
- **Bad**: jsdom is not WKWebView; webview-specific rendering issues escape the suite ([ADR 0001](0001-use-tauri-instead-of-electron.md) consequence).
- **Neutral**: The pure-core rule doubles as a design pressure — new features tend to be written testable-first.

## Related

- [ADR 0010](0010-version-history-via-shadow-snapshots.md), [ADR 0012](0012-crash-resilience-strategy.md) — main beneficiaries of this strategy.
