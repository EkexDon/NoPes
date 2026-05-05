# NoPes — Roadmap

> **Last Updated:** May 5, 2026
> **Maintainer:** Ekin Baca

---

## 🟢 Phase 1: Stability & Core Polish — ✅ DONE

**Status:** Complete  
**Shipped:** May 5, 2026

### Grey Screen Crash Prevention
- [x] **Global JS Error Handlers** — `window.addEventListener('error')` and `unhandledrejection` handlers in `main.tsx` catch uncaught exceptions before React sees them. If the root DOM goes blank, an auto-reload fires after 2s.
- [x] **Rust Panic Logger** — `nopes_crash.log` captures full panic stack traces from the Tauri backend for post-mortem debugging. Implemented via `std::panic::set_hook`.
- [x] **ErrorBoundary Auto-Retry** — Up to 2 automatic recovery attempts with exponential backoff (1.5s, 3s). Shows crash timestamp, attempt count, and a "Try Again" / "Hard Reload" UI.
- [x] **Window CloseRequested Handler** — Ollama process cleanup fires on both `Destroyed` *and* `CloseRequested` events, preventing zombie processes when the app crashes mid-transition.

### Memory Optimization
- [x] **Double-Destroy Guard** — `editorLifecycle.ts` checks `isDestroyed` before calling `editor.destroy()`, preventing the crash that occurs when React Strict Mode fires cleanup twice.
- [x] **Save Timer Cleanup** — `saveTimerRef` is cleared on unmount to prevent stale writes to a destroyed editor instance.
- [x] **Tippy Delegate Leak Fix** — WikiLink tooltip delegate is tracked in a ref and explicitly destroyed before recreation, preventing tippy instance accumulation across tab switches.
- [x] **Global Click Handler Cleanup** — The `mousedown` listener for WikiLink navigation is properly paired with its removal, scoped to the tippy delegate lifecycle.
- [x] **Editor Content Sync Guard** — All `editor.commands.*` calls are wrapped in `isDestroyed` checks and try/catch blocks to prevent the `RangeError: textBetween out of range` crash.
- [x] **Asset Insert Guard** — `pendingAssetInserts` handler checks `editor.isDestroyed` before attempting insertion.
- [x] **Debug Log Cleanup** — Removed verbose `console.log('--- WIKILINK MOUSEDOWN DETECTED ---')` from production path.

### Media Refinement
- [x] **Drag-and-Drop Loading State** — Import overlay with animated spinner appears during file copy operations. Prevents user interaction with a partially-loaded editor.
- [x] **Per-File Error Isolation** — Individual file import failures no longer abort the entire batch. Each file gets its own try/catch with a toast error notification.
- [x] **Import Success Feedback** — Toast notification confirms the number of successfully imported files.
- [x] **PDF Loading Indicator** — PDFs show a "Loading PDF…" overlay that disappears on iframe load, with error fallback text.
- [x] **Video Metadata Preload** — Videos use `preload="metadata"` instead of full preload, reducing memory usage and enabling zero-latency first-frame display.
- [x] **Image Lazy Loading** — Images use `loading="lazy"` attribute for deferred loading of off-screen media.
- [x] **Media Error Fallbacks** — Images, videos, and PDFs all have `onerror` handlers that display visual indicators instead of silently breaking.
- [x] **Asset Path Safety** — `resolveAssetSrc` wrapped in try/catch to prevent `convertFileSrc` failures from crashing the editor.
- [x] **Drop Zone Visual** — Animated "Drop files to import" overlay with pulsing accent color.

### Tests
- [x] 31 tests passing (up from 16)
- [x] `noteeditor-destroy.test.ts` — 6 tests covering double-destroy, null safety, missing commands, destroy() errors
- [x] `phase1-integration.test.ts` — 11 tests covering grey screen handlers, timer cleanup, tippy cleanup, media type detection, filename collision prevention, editor sync guards, WikiLink regex safety

---

## 🟡 Phase 2: Platform Expansion (Near-Term)

### Windows & Linux Builds
- [ ] GitHub Actions CI/CD pipeline for `.exe` (Windows) and `.AppImage` / `.deb` (Linux)
- [ ] Cross-platform path separator handling audit
- [ ] Windows-specific Ollama path detection (`C:\Users\...\ollama.exe`)

### Vault Migration Tools
- [ ] Bulk `.docx` → Markdown converter (folder-level)
- [ ] Notion export importer
- [ ] Obsidian vault compatibility checker

---

## 🔵 Phase 3: Intelligence & Interconnectivity (Mid-Term)

### Advanced AI Context
- [ ] Include file tags and backlinks in AI context window
- [ ] "Save to Note" feature for AI-generated summaries
- [ ] Multi-model support (Llama 3.2 1B, 3B, 7B)

### Semantic Search
- [ ] Vector-based search ("find notes about X" even if X isn't mentioned)
- [ ] Embedding model selection in Settings
- [ ] Search results with relevance scoring UI

### Graph Enhancements
- [ ] Filter graph by date range
- [ ] Cluster detection and visual grouping
- [ ] Graph export as SVG/PNG

---

## 🟣 Phase 4: Ecosystem Integration (Long-Term)

### Mobile/Web Sync
- [ ] E2E encrypted sync via `nopes-web` infrastructure
- [ ] Conflict resolution for concurrent edits
- [ ] Mobile companion app (read-only viewer)

### Plugin API
- [ ] TipTap extension loader for community plugins
- [ ] Theme engine (user-created CSS themes)
- [ ] Keyboard shortcut customization

---

*Local-first. Privacy-first. Thought-first.*
