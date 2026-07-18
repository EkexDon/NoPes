/**
 * End-to-end tests for the Web Clipper capture pipeline:
 * extension capture (clipper-extension/capture.js, run against jsdom)
 * → app conversion (htmlToMarkdown) → final note (buildClipNote).
 *
 * fixtures/github-readme.html is the real <article> element served by
 * https://github.com/EkexDon/NoPes — the exact page whose clip came out
 * as one flat run-on line before this pipeline existed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// capture.js is a classic script (the extension injects it as a file), so it
// publishes capturePayload on globalThis instead of exporting it.
import '../../clipper-extension/capture.js';
import { htmlToMarkdown, buildClipNote } from '../clip';

interface CaptureResult { html: string; text: string; truncated: boolean }
const capturePayload = (globalThis as unknown as { capturePayload: () => CaptureResult }).capturePayload;

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'github-readme.html'), 'utf-8');
const NOW = new Date(2026, 6, 16, 14, 39);

function loadPage(bodyHtml: string, baseHref = 'https://github.com/EkexDon/NoPes') {
  document.head.innerHTML = `<base href="${baseHref}">`;
  document.body.innerHTML = bodyHtml;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('capturePayload — page mode', () => {
  it('captures the article content with structure intact', () => {
    loadPage(FIXTURE);
    const { html, truncated } = capturePayload();
    expect(truncated).toBe(false);
    expect(html).toContain('<h2');
    expect(html).toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<script');
  });

  it('resolves relative image and link URLs to absolute ones', () => {
    loadPage('<article><img src="docs/pic.png" alt="p"><a href="/EkexDon/NoPes/blob/main/TUTORIAL.md">Tutorial</a></article>');
    const { html } = capturePayload();
    expect(html).toContain('src="https://github.com/EkexDon/docs/pic.png"');
    expect(html).toContain('href="https://github.com/EkexDon/NoPes/blob/main/TUTORIAL.md"');
  });

  it('recovers lazy-loaded images from data-src', () => {
    loadPage('<article><img data-src="https://cdn.x.dev/lazy.jpg" alt="lazy"></article>');
    expect(capturePayload().html).toContain('src="https://cdn.x.dev/lazy.jpg"');
  });

  it('strips heading permalink anchors and presentation attributes', () => {
    loadPage(FIXTURE);
    const { html } = capturePayload();
    expect(html).not.toContain('class="anchor');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
  });

  it('provides a plain-text fallback even without a selection', () => {
    loadPage('<article><h1>Title</h1><p>Body text.</p></article>');
    const { text } = capturePayload();
    expect(text).toContain('Body text.');
  });
});

describe('capturePayload — selection mode', () => {
  it('captures only the selected fragment, as html and text', () => {
    loadPage('<p id="keep">Selected <strong>rich</strong> part.</p><p>Rest of page.</p>');
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('keep')!);
    window.getSelection()!.addRange(range);
    const { html, text } = capturePayload();
    expect(html).toContain('<strong>rich</strong>');
    expect(html).not.toContain('Rest of page');
    expect(text).toContain('Selected rich part.');
  });
});

describe('full pipeline: real GitHub README → markdown note', () => {
  it('turns the clipped page into structured markdown with images', () => {
    loadPage(FIXTURE);
    const { html } = capturePayload();
    const md = htmlToMarkdown(html);

    // Headings survive as headings, not run-on text.
    expect(md).toContain('## Why NoPes');
    expect(md).toMatch(/^#{1,3} .*Capture — never lose a thought/m);
    // The hero image survives as a markdown image with absolute URL.
    expect(md).toMatch(/!\[[^\]]*\]\(https:\/\/[^)]+\)/);
    // Lists survive as list items.
    expect(md).toMatch(/^\s*(-|\d+\.)\s+\*\*You will never lose a thought\.\*\*/m);
    // No permalink garbage.
    expect(md).not.toContain('[](#');
    // Multiple blocks — not one flat line.
    expect(md.split('\n').length).toBeGreaterThan(30);
  });

  it('builds a complete note from the captured payload', () => {
    loadPage(FIXTURE);
    const captured = capturePayload();
    const note = buildClipNote({
      title: 'GitHub - EkexDon/NoPes',
      url: 'https://github.com/EkexDon/NoPes',
      selection: captured.text,
      html: captured.html,
      truncated: captured.truncated,
    }, NOW);
    expect(note).toContain('# GitHub - EkexDon/NoPes');
    expect(note).toContain('## Why NoPes');
    expect(note).toMatch(/!\[[^\]]*\]\(https:\/\/[^)]+\)/);
    expect(note).toContain('#clipped');
    expect(note).not.toContain('clip was truncated');
  });
});
