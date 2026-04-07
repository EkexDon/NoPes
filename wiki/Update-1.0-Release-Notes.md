# NoPes — Update 1.0 Release Notes

> **Release Date:** April 7, 2026
> **Branch:** `main`
> **Commit:** Post `8cf442f`

---

## 🚀 What's New in v1.0

This update is a massive leap forward for NoPes, transforming it from a simple markdown editor into a full-featured, intelligent second-brain application. Below is a complete breakdown of every feature added and bug fixed.

---

## 🗂️ File Management

### Rename Files Inline
- Hover over any file or folder in the sidebar to reveal an ✏️ **Edit** icon.
- Clicking it transforms the file name into an **inline text input** — edit and press `Enter` or click away to confirm.
- Pressing `Escape` cancels the rename.
- Renaming a note automatically rewrites **all `[[WikiLinks]]`** across your entire vault that referenced the old name, keeping your knowledge graph intact.

### Delete Files
- A 🗑️ **Delete** icon appears on hover next to every file.
- Deletion prompts a confirmation dialog before permanently removing the file.
- Open tabs for the deleted file are automatically closed.

### Tauri Permissions Fixed
- Added `fs:allow-rename` and `opener:allow-open-path` with explicit path scopes (`**`) to `capabilities/default.json` so all file operations are properly authorized.

---

## 🔗 Graph & Interconnectivity Upgrades

### Tagging System
- Write `#tagname` anywhere in a note — tags are automatically extracted.
- Graph nodes are **color-coded** dynamically based on their primary tag.
- A **tag filter bar** appears on the Graph View, allowing you to highlight and isolate specific knowledge clusters.

### Unlinked Mentions
- The backlinks pane now has two sections: **Linked Mentions** and **Unlinked Mentions**.
- Unlinked Mentions scans your entire vault in real-time to find places where the current note's title appears as plain text (not wrapped in `[[ ]]`), letting you discover hidden connections.

### Interactive Node Creation
- **Double-click** any empty space in the Graph View to instantly spawn a new note at that position, automatically linked into your graph.

---

## 🖼️ Rich Media & Asset Integration

### Drag-and-Drop Any File
Drag any of the following onto the NoPes window and it is automatically:
1. **Copied** into a local `assets/` folder inside your vault.
2. **Embedded** directly into the currently open note.

Supported formats:

| Format | Rendering |
|--------|-----------|
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | Inline image with rounded corners |
| `.mp4`, `.webm`, `.mov` | Native `<video>` player with controls |
| `.pdf` | Full scrollable inline iframe (all pages, WebKit native) |

### Full-Page PDF Viewer (Inline)
- PDFs are rendered inside the note using a native **WebKit iframe** at 80% of the viewport height.
- All pages are scrollable with zoom, text selection, and native macOS PDF controls.
- Powered by enabling `assetProtocol` in `tauri.conf.json`.

### Video Playback
- Videos render as a native `<video>` element with controls directly in the note.
- Supports `.mp4`, `.webm`, and `.mov`.
- Path resolution uses Tauri's secure `convertFileSrc` (asset protocol) bridge.

### Non-Markdown Files in Sidebar
- Clicking a PDF, video, or image in the file sidebar **opens it in your default system app** (Preview, QuickLook, VLC, etc.) via `openPath`.
- Markdown files continue to open in the NoPes editor as before.

---

## 🧠 Editor Improvements

### WikiLink Crash Fix
- Fixed a fatal `RangeError: textBetween out of range` crash in the TipTap suggestion engine.
- When backspacing a `[[link]]`, the engine no longer tries to read deleted text positions, preventing the entire app from crashing to a black screen.

### Error Boundary
- Added a React `<ErrorBoundary>` around the entire application.
- If any component crashes, instead of a blank black screen, you now see a **diagnostic red panel** showing the exact stack trace and a "Reload" button.

---

## 🗺️ Graph View — Full-Screen Fix

- The Graph View previously got **cut off** when NoPes was maximized or entered full-screen mode.
- Fixed with a `ResizeObserver` that dynamically feeds the exact container pixel dimensions into the force graph engine.
- Added integer-rounding (`Math.floor`) to prevent floating-point ResizeObserver feedback loops that caused the UI to require double-clicks.

---

## 🔐 Tauri Security

The following permissions were added/updated in `capabilities/default.json`:

| Permission | Reason |
|---|---|
| `fs:allow-rename` (scoped `**`) | Enables in-app file renaming |
| `opener:allow-open-path` (scoped `**`) | Opens PDFs/videos in system apps |

And in `tauri.conf.json`:
```json
"assetProtocol": {
  "enable": true,
  "scope": ["**"]
}
```
This enables the `asset://` protocol, which is required for local images, videos, and PDFs to load inside the WebView.

---

## 🐛 Bug Fixes

| Bug | Fix |
|-----|-----|
| Renaming a note caused a black screen | Tab state is now migrated in-place; no tab is closed |
| WikiLinks broke after rename | Global vault scan rewrites all `[[OldName]]` → `[[NewName]]` |
| Graph cut off in full-screen | ResizeObserver dynamically feeds dimensions to ForceGraph2D |
| Double-click required after fullscreen | Fixed ResizeObserver float feedback loop with integer rounding |
| PDF shows only 1 page | Switched from `<img>` to `<iframe>` for full-page scrollable rendering |
| Video shows black box | Enabled Tauri Asset Protocol so `asset://` URLs resolve correctly |
| Clicking PDF in sidebar freezes app | Non-markdown files now route to `openPath` instead of the editor |
| `fs.rename not allowed` error | Added `fs:allow-rename` permission with `**` scope |
| `openPath not allowed` error | Added `opener:allow-open-path` permission with `**` scope |

---

## 📁 Files Changed

```
src-tauri/Cargo.lock
src-tauri/Cargo.toml
src-tauri/capabilities/default.json
src-tauri/tauri.conf.json
src/App.tsx
src/components/CommandBar.tsx
src/components/GraphView.tsx
src/components/NoteEditor.tsx
src/components/Sidebar.tsx
src/index.css
src/store/useStore.ts
```

---

*Built with passion by the NoPes team. Local-first. Your knowledge, your machine.*
