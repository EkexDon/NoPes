# 0007 — Local AI via an Ollama sidecar process managed by the Rust backend

- Status: accepted
- Date: 2026-07 (retroactive)

## Context and Problem Statement

The AI assistant (VaultChat: chat with the vault, summarize notes) needs an LLM. Cloud APIs (OpenAI, Anthropic) offer quality and zero local resources but contradict the core promise: "100% offline. No API keys, no tracking." How do we run an LLM locally without turning NoPes into an ML runtime?

## Decision Drivers

- Privacy-first: note content must never leave the machine.
- No API keys, no accounts, no per-token costs.
- The LLM runtime should be independently upgradable and must not bloat the app bundle.
- The app must clean up after itself — no zombie GPU/RAM-hungry processes.

## Considered Options

- **Ollama as a sidecar process**, spoken to via its local HTTP API (port 11434)
- **Cloud LLM APIs** — rejected on principle
- **In-process inference** (llama.cpp bindings in Rust, or transformers.js/WebLLM in the webview)
- **Require the user to run Ollama themselves** — no lifecycle management

## Decision Outcome

Chosen option: **Ollama sidecar, supervised by the Rust backend** (`src-tauri/src/lib.rs`).

- `get_ollama_path()` resolves the binary: bundled copy first, then standard system paths (`/usr/local/bin`, `/opt/homebrew/bin`, …).
- `start_ollama_service` spawns `ollama serve` only if port 11434 is free — an already-running user instance is respected, never duplicated.
- The child `pid` is held in Tauri-managed state (`OllamaProcess(Mutex<Option<Child>>)`) and killed on both `Destroyed` and `CloseRequested` of the main window, preventing zombie processes even on crashes.
- The frontend opts in: Rust only starts Ollama when the UI calls `manage_ollama(true)` (AI enabled in settings). `ensure_model` pulls `llama3.2:1b` on demand.
- A small default model (`llama3.2:1b`) keeps first-run download and RAM within reach of ordinary laptops; multi-model support is on the roadmap.

### Consequences

- **Good**: True offline AI with zero configuration for users who have Ollama; graceful takeover if they already run it.
- **Good**: LLM runtime updates (new models, Metal/CUDA improvements) arrive via Ollama without NoPes releases.
- **Bad**: Quality of a 1B model is far below cloud frontier models; user expectations need managing.
- **Bad**: An external binary dependency — path detection is macOS-centric and Windows support needs work (ROADMAP Phase 2).
- **Bad**: Ollama RAM usage is significant and visible; the memory monitor (`get_system_stats`) reports it separately, and AI can be toggled off entirely.

## Related

- [ADR 0008](0008-ai-embeddings-in-web-worker.md) — embeddings deliberately do *not* use Ollama.
- [ADR 0001](0001-use-tauri-instead-of-electron.md) — process supervision lives in the Rust shell.
