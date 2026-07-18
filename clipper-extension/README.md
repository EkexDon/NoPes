# NoPes Web Clipper

Clips pages and selections straight into your local NoPes vault — **with full
structure**: headings, lists, tables, links, inline code, and images all survive
as Markdown. Nothing ever leaves your machine: the extension talks only to
`127.0.0.1:21787`, where the NoPes app listens (token-gated, off by default).

## Install (unpacked)
1. In NoPes: **Settings → General → Web Clipper** → enable, click the token to copy it.
2. Chrome/Edge/Brave: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick this folder.
3. Click the extension's *Options* (or it opens automatically on first clip) → paste the token → Save.

## ⚠️ After updating this folder: reload the extension
Chrome caches unpacked extensions — file changes here do **nothing** until you
reload: `chrome://extensions` → NoPes Web Clipper → ↻ reload button.
**Check the version number on the card afterwards** — it must match the
`version` in `manifest.json` here. If a clip arrives as one flat line of text
(and NoPes shows an "extension is outdated" warning), you're running a stale
version. A "page blocks capture" notice instead means the browser forbids
script injection on that page (chrome:// pages, Chrome Web Store, the built-in
PDF viewer) — no reload will change that; only the plain text can be clipped.

## Use
- Select text → right-click → **Clip selection to NoPes**
- Right-click anywhere → **Clip page to NoPes** (captures the page's main content — `<article>`/`<main>`)
- Or click the toolbar icon to clip the page (plus any selection).

Clips land in your vault under `Clips/` with source URL and a `#clipped` tag.

## How capture works
`capture.js` runs inside the page — injected as a plain file
(`chrome.scripting.executeScript` with `files`, followed by `run-capture.js`
whose completion value is the result), so no function serialization or module
machinery is involved. It strips page chrome (nav, footers,
scripts, SVG icons…), resolves image/link URLs to absolute ones (including
lazy-loaded `data-src` images), removes empty permalink anchors, and sheds all
presentation attributes. The NoPes app converts the resulting HTML to Markdown
with Turndown (+ GFM tables). Very large pages are truncated at 1.5 MB and the
note is marked accordingly.

**Images are mirrored into your vault**: on save, NoPes downloads every image
referenced by the clip into `assets/` (deduplicated by URL) and rewrites the
note to the local files — clips stay readable offline and never phone home
when you open them. Images that fail to download keep their remote URL.

The same `capture.js` is imported by the app's test suite
(`src/__tests__/clipCapture.test.ts`), which runs it against a real GitHub
README fixture — if you change capture behavior, run `npx vitest run` in the
app repo.
