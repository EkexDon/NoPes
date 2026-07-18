# 0012 — Layered crash resilience: JS handlers, ErrorBoundary retry, Rust panic logger

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Early versions suffered a "grey screen" crash class: the webview rendered blank after uncaught JS errors (often ProseMirror lifecycle violations, see [ADR 0005](0005-tiptap-prosemirror-editor-engine.md)) or Rust panics, with no diagnostics and no recovery path. For a tool holding a user's second brain, silent death is unacceptable. A single mechanism can't cover both worlds (JS + Rust), so what does a complete resilience strategy look like?

## Decision Drivers

- The app must self-recover when possible and leave forensics when not.
- Failures happen on both sides of the Tauri boundary: JS exceptions and Rust panics.
- Cleanup obligations (Ollama child process) must hold even on abnormal exits.
- React Strict Mode's double-effects must be survivable, not disabled.

## Considered Options

- **Layered defense**: global JS handlers + ErrorBoundary auto-retry + Rust panic hook + guarded editor lifecycle
- **Single top-level ErrorBoundary** only — misses async errors and Rust panics
- **Crash reporting service** (Sentry) — telemetry conflicts with the privacy-first promise

## Decision Outcome

Chosen option: **layered defense**, all local, no telemetry.

- **Layer 1 — global JS handlers** (`src/main.tsx`): `window.addEventListener('error')` and `'unhandledrejection'` log everything; if `#root` has gone blank, a recovery reload fires after 2 s.
- **Layer 2 — ErrorBoundary auto-retry**: up to 2 automatic recovery attempts with exponential backoff (1.5 s, 3 s), then a UI with crash timestamp, attempt count, and "Try Again" / "Hard Reload" actions.
- **Layer 3 — Rust panic logger** (`src-tauri/src/lib.rs`): `std::panic::set_hook` appends timestamped stack traces to `nopes_crash.log` for post-mortem debugging.
- **Layer 4 — lifecycle guards at the root cause**: `editorLifecycle.ts` prevents double-destroy; all `editor.commands.*` calls check `isDestroyed`; tippy delegates and save timers are torn down deterministically. These fix the *sources*, layers 1–3 catch the *residue*.
- **Layer 5 — cleanup on abnormal exit**: Ollama teardown fires on both `CloseRequested` and `Destroyed`, so crashes mid-transition don't leak processes ([ADR 0007](0007-local-ai-via-ollama-sidecar.md)).

### Consequences

- **Good**: The grey-screen class was eliminated in Phase 1; regressions surface as logged, recoverable events instead of blank windows.
- **Good**: All diagnostics stay on the user's machine — consistent with the privacy promise.
- **Bad**: Auto-reload as a last resort can lose unsaved in-memory state; mitigated by auto-save and history snapshots ([ADR 0010](0010-version-history-via-shadow-snapshots.md)).
- **Bad**: `nopes_crash.log` is written to the process working directory and relies on users to find and share it; there is no aggregate visibility into crash frequency in the field — a deliberate trade for privacy.
- **Neutral**: Guarded-lifecycle discipline is enforced by tests (`noteeditor-destroy.test.ts`, `phase1-integration.test.ts`), not by types.

## Related

- [ADR 0005](0005-tiptap-prosemirror-editor-engine.md) — main source of the original crash class.
- [ADR 0014](0014-vitest-testing-strategy.md) — regression coverage for the guards.
