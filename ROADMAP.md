# NoPes — Roadmap

> **Last Updated:** July 9, 2026
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

## 🟢 v2.1: "Never Lose a Thought" — ✅ DONE

**Status:** Complete
**Shipped:** July 9, 2026

### Global Quick Capture
- [x] **⌥Space global hotkey** — summons a tiny always-on-top capture window from anywhere (registered in Rust via `tauri-plugin-global-shortcut`; falls back gracefully if another app owns the shortcut).
- [x] **Menu-bar tray icon** — Open NoPes / Quick Capture / Quit. Built with Tauri's `tray-icon` feature.
- [x] **Second frameless window** — the `capture` window is transparent, skip-taskbar, and shares no store state with the main window: it writes today's daily note via the filesystem and emits `nopes:capture-saved`, which the main window consumes to refresh.
- [x] **Daily-note append** — captures land under a `## 📥 Captures` section in `YYYY-MM-DD.md` (same convention as the Journal), created on demand. Pure formatter covered by 9 tests (`captures.test.ts`).
- [ ] Launch-at-login toggle (follow-up — capture currently works while NoPes runs)

### Version History / Time Machine
- [x] **Automatic snapshots** — every save preserves the pre-save state (rate-limited to 1/min per note) as shadow copies in `.nopes/history/<key>/<timestamp>.md`. Deliberately not git: vaults are often already git repos.
- [x] **Pruning policy** — keep all <1 h, hourly for a day, daily for a month, weekly forever. Pure `planPruning` covered by tests.
- [x] **History panel** — clock icon in the editor topbar: snapshot list, LCS line-diff vs current (+N/−N stats), one-click restore. Restore force-snapshots the current state first, so restoring can never lose data.
- [x] **Deletion safety** — deleting a note force-snapshots it first; renames/moves migrate the note's history folder.
- [x] 17 tests (`history.test.ts`) for naming, stamp round-trips, pruning buckets, and the diff engine.

### Backlinks & Unlinked Mentions
- [x] **Linked mentions** — notes that `[[link]]` here, robust against force-graph's link mutation.
- [x] **Unlinked mentions** — word-boundary, case-insensitive matches with context snippets; existing wikilinks, code blocks, and inline code are masked out. Capped at 500 files, debounced.
- [x] **One-click "Link"** — rewrites the mentioning file, turning every plain-text mention into a `[[wikilink]]` (alias form preserves original casing). 14 tests (`mentions.test.ts`).

### Delight
- [x] **Graph pulse** — new `[[links]]` fire an accent-colored particle along the edge while the Graph is open.
- [x] **Streak confetti** — dependency-free confetti + toast at 7/30/100-day journal streaks, once per streak.
- [x] **Typewriter mode** — Zen mode keeps the caret vertically centered (per-pane, split-view safe).

---

## 🟢 v2.2: "Your Vault Works for You" — ✅ DONE

**Status:** Complete
**Shipped:** July 9, 2026

### Vault Index (keystone)
- [x] **Incremental extraction layer** (`src/vaultIndex.ts`) — tasks (lenient checkbox forms, `@due(date)`, `#tags`, line numbers), wikilinks, note tags, frontmatter, word counts. Pure extractors, 25 tests.
- [x] **Persistence & reconcile** — `.nopes/index.json` (schema-versioned), mtime-based reconcile on vault load reads only new/changed files; saves/deletes/renames update it in lockstep. Views subscribe via a store `indexVersion` counter.

### Task Dashboard
- [x] **Tasks view (⌘T)** — every open `- [ ]` across the vault, grouped by due date (Overdue/Today/This week/Later/No date), note, or tag; done tasks toggleable into view.
- [x] **Safe toggling** — checking a task rewrites exactly its source line, verification-first: if the note changed since indexing, the toggle refuses instead of corrupting (then refreshes).
- [x] **`@due(YYYY-MM-DD)` syntax** — portable plain text; overdue red, today amber.
- [x] **Native notifications** — `tauri-plugin-notification`; once per day on launch: "N tasks due today · M overdue".

### AI Auto-Linking
- [x] **Related-note suggestions** — semantic hits from the existing embeddings become `[[link]]` chips in the editor's connections pane (score ≥ 0.3, already-linked and self filtered out). One click inserts the wikilink; dismissals persist per note. 9 tests.

### Weekly AI Digest
- [x] **"Your Week" note** — generated locally by Ollama: focus summary, patterns, next-week bullets + stats footer with wikilinks to touched notes. Fires Sunday evening for the current week or as catch-up on the first launch of a new week; once per week; silent no-op when Ollama is down (retries next launch). Settings toggle. 10 tests.

### Vault Lock
- [x] **App-level privacy lock** — PBKDF2-SHA256 (210k iterations, WebCrypto, random salt), verifier in localStorage. Lock on launch + ⌘L panic hotkey (works even while typing). Settings → Security: enable/change/disable with current-password verification. 8 tests.
- [x] Honest scope: this locks the UI; notes on disk stay plain markdown. Per-note encryption + Touch ID keychain wrap are the documented follow-ups (after Version History soak time).

---

## 🟢 v3.0: "The Private Superbrain" — ✅ DONE

**Status:** Complete
**Shipped:** July 9, 2026

### Voice Memos + Local Whisper
- [x] **Mic button in the editor** — record, stop, and the transcript (+ a link to the saved WAV in `assets/`) lands in the note. 100% on-device.
- [x] **whisper.cpp integration** — binary discovery like Ollama (`brew install whisper-cpp`), multilingual `ggml-base` model downloaded on demand (142 MB, progress UI, never bundled), `spawn_blocking` so transcription can't stall the runtime. Language auto-detect (German + English).
- [x] **Audio pipeline** — MediaRecorder → decode → mono → linear resample to 16 kHz → 16-bit PCM WAV, all pure and unit-tested (`audio.test.ts`, 13 tests). Mic permission via Info.plist + `audio-input` entitlement.

### Spaced Repetition
- [x] **`Question ?? Answer`** on any line becomes a flashcard (extracted by the Vault Index, schema v2).
- [x] **SM-2 scheduling** with Again/Hard/Good/Easy, lapses, ease floor — full review LOG persisted to `.nopes/srs.json` so an FSRS upgrade is a pure recompute. 12 tests.
- [x] **Review view (⌘R)** — flip with space, grade with 1–4, due-first queue with a 20-new-cards/day cap, achievements tie-in.
- [x] **Learning upgrade (same release)** — cloze deletions (`{{...}}`, one card per cloze), bidirectional `???` cards, multi-line block cards (`??` on its own line), markdown-rendered card faces (html off), decks from note tags, session progress bar + accuracy/time summary, next-interval preview on grade buttons, undo (`u`), per-card suspend + card browser, 7-day due forecast, review streaks with confetti milestones, due-card counts in the daily notification, `/Flashcard` slash command. SrsStore v2 (v1 migrates cleanly). Custom decks (playlists) with Browse-tab assignment, automatic folder + tag decks, and ⚡ Quiz mode: full-deck shuffled cram sessions (seeded Fisher-Yates) that never mutate SRS state; Again requeues until answered. In-memory store cache (no disk races) + persistent daily new-card allowance. Daily Deck mode: every card once/day, done-set persisted (restart-safe, day-rollover, late-written cards join), no instant requeue by design — quiz mode is the explicit escape hatch. Startup fix: index reconcile now always bumps indexVersion (an early autosave used to swallow the bump → Review stayed empty until the next save); Review self-populates when cards arrive late without resetting an active session. 40 engine tests.

### Local OCR
- [x] **OCR button on images** — hover an image in the editor, click 🔍 OCR, and the recognized text is inserted below it (where it's naturally searchable). English + German.
- [x] **Zero CDN** — tesseract.js worker, wasm core, and traineddata are bundled in `public/ocr/`; nothing is fetched from the internet.

### Properties + Live Queries
- [x] **Read-only frontmatter chips** above the editor (read-only by design — rewriting frontmatter through the editor is a data-risk path).
- [x] **```nopes-query``` blocks** — atom nodes (same data-safe pattern as Mermaid) rendering live note lists: `tag=#x key=value has=tasks|cards|links name=substr sort=modified|name|words limit=N`. Flat filters, deliberately not a DSL. 10 engine tests + round-trip tests.

### Web Clipper
- [x] **Loopback intake** — `tiny_http` bound to 127.0.0.1:21787 ONLY, token-gated (32-hex CSPRNG token), OFF by default, CORS-correct; clips are emitted to the frontend which writes `Clips/<title>.md` with the normal permission-scoped FS access.
- [x] **MV3 extension** (`clipper-extension/`) — context-menu "Clip selection/page", toolbar click, options page for the token, badge feedback. Load unpacked; store submission when ready.

### Quick Capture follow-up
- [x] **Launch at Login** toggle (tauri-plugin-autostart, LaunchAgent) — ⌥Space capture is now always one keystroke away.

### Deferred by design
- [ ] Per-note encryption + Touch ID keychain wrap — ships only after Version History has real-world soak time (decision log #6).

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
