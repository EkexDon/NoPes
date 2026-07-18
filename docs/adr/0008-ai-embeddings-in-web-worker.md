# 0008 — AI embeddings in a Web Worker with idle-timeout termination

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

Semantic features (vault search, related notes) need text embeddings. Embedding a whole vault is CPU-heavy; running it on the UI thread would freeze the editor. Where should the embedding model run, and how do we keep its memory cost from undermining the "high-performance" promise?

## Decision Drivers

- The UI thread must stay responsive during vault-wide embedding runs.
- Embedding models (via `@huggingface/transformers`) hold hundreds of MB once loaded — unacceptable as a permanent resident.
- Callers want a simple `async` API, not `postMessage` plumbing.
- Worker crashes (OOM) must not leave the app hanging on unresolved promises.

## Considered Options

- **Dedicated Web Worker** (`ai.worker.ts`) wrapped by a promise-based singleton (`AIService.ts`)
- **Main-thread transformers.js** — simplest, freezes the UI
- **Embeddings via Ollama** — couples semantic search availability to the LLM sidecar being installed/enabled
- **Rust-side embeddings** (candle/ort) — fastest, but heavy build complexity

## Decision Outcome

Chosen option: **Web Worker + `AIService` singleton facade** (`src/workers/AIService.ts`, `src/workers/ai.worker.ts`).

- `AIService` lazily spawns the worker on first call and exposes `init` / `embedQuery` / `embedDocs` / `search` as promises; message correlation uses per-call IDs in a `pendingCallbacks` map.
- **Idle timeout**: after 5 minutes without calls, the worker is terminated and its model memory freed (`resetIdleTimer` → `AIService.terminate()`); the next call transparently respawns it.
- Vector search runs inside the worker against a synced index; `Float32Array` buffers cross the boundary as **transferables**, avoiding copies.
- `worker.onerror` rejects all pending promises and tears the worker down, so an OOM crash surfaces as catchable errors instead of a hung UI.
- Status/progress listeners feed UI indicators during long embedding runs.

### Consequences

- **Good**: The editor never blocks on AI work; memory returns to baseline after 5 idle minutes — this pattern resolved a major leak class from the memory-leak investigation.
- **Good**: Callers are fully insulated from worker lifecycle; respawn-on-demand is invisible.
- **Bad**: First call after idle pays a cold-start penalty (worker spawn + model load).
- **Bad**: The in-memory index must be re-synced to a fresh worker (`syncedIndexRef` invalidation) — a subtle invariant that tests must guard.
- **Neutral**: Two separate AI runtimes coexist (transformers.js for embeddings, Ollama for generation, [ADR 0007](0007-local-ai-via-ollama-sidecar.md)); this is deliberate — semantic search works even with the LLM disabled.

## Related

- [ADR 0007](0007-local-ai-via-ollama-sidecar.md) — generation counterpart.
