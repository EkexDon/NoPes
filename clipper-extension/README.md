# NoPes Web Clipper

Clips pages and selections straight into your local NoPes vault. Nothing ever
leaves your machine: the extension talks only to `127.0.0.1:21787`, where the
NoPes app listens (token-gated, off by default).

## Install (unpacked)
1. In NoPes: **Settings → General → Web Clipper** → enable, click the token to copy it.
2. Chrome/Edge/Brave: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick this folder.
3. Click the extension's *Options* (or it opens automatically on first clip) → paste the token → Save.

## Use
- Select text → right-click → **Clip selection to NoPes**
- Right-click anywhere → **Clip page to NoPes**
- Or click the toolbar icon to clip the page (plus any selection).

Clips land in your vault under `Clips/` with source URL and a `#clipped` tag.
