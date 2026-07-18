import { describe, it, expect, beforeEach } from 'vitest';
import { clipNoteName, buildClipNote, getClipperToken } from '../clip';

const NOW = new Date(2026, 6, 9, 14, 30);

describe('clipNoteName', () => {
  it('uses a sanitized title', () => {
    expect(clipNoteName('Great Article: How? <Really>', NOW)).toBe('Great Article How Really.md');
  });
  it('falls back to a timestamp name when title is empty/missing', () => {
    expect(clipNoteName(undefined, NOW)).toBe('Clip 2026-07-09 1430.md');
    expect(clipNoteName('///', NOW)).toBe('Clip 2026-07-09 1430.md');
  });
  it('caps very long titles', () => {
    expect(clipNoteName('x'.repeat(300), NOW).length).toBeLessThanOrEqual(84);
  });
});

describe('buildClipNote', () => {
  it('includes title, source, selection, and the clipped tag', () => {
    const note = buildClipNote(
      { title: 'My Article', url: 'https://x.dev/a', selection: 'Key quote.' }, NOW,
    );
    expect(note).toContain('# My Article');
    expect(note).toContain('Key quote.');
    expect(note).toContain('[Source](https://x.dev/a)');
    expect(note).toContain('#clipped');
  });
  it('survives missing fields', () => {
    const note = buildClipNote({}, NOW);
    expect(note).toContain('# Web Clip');
    expect(note).toContain('#clipped');
  });

  it('preserves text structure when the payload carries html', () => {
    const note = buildClipNote({
      title: 'Structured',
      url: 'https://x.dev/a',
      selection: 'Heading Some bold text. one two',
      html: '<h2>Heading</h2><p>Some <strong>bold</strong> text.</p><ul><li>one</li><li>two</li></ul>',
    }, NOW);
    expect(note).toContain('## Heading');
    expect(note).toContain('**bold**');
    expect(note).toMatch(/-\s+one\n-\s+two/);
  });

  it('keeps images as markdown with their remote URL', () => {
    const note = buildClipNote({
      title: 'With Image',
      html: '<p>Intro</p><img src="https://x.dev/pic.png" alt="A pic">',
    }, NOW);
    expect(note).toContain('![A pic](https://x.dev/pic.png)');
  });

  it('keeps links as markdown', () => {
    const note = buildClipNote({
      html: '<p>See <a href="https://x.dev/docs">the docs</a>.</p>',
    }, NOW);
    expect(note).toContain('[the docs](https://x.dev/docs)');
  });

  it('falls back to plain selection when html is empty or missing', () => {
    const note = buildClipNote({ selection: 'plain text', html: '' }, NOW);
    expect(note).toContain('plain text');
  });

  it('drops script/style content from clipped html', () => {
    const note = buildClipNote({
      html: '<p>keep</p><script>alert(1)</script><style>.x{color:red}</style>',
    }, NOW);
    expect(note).toContain('keep');
    expect(note).not.toContain('alert(1)');
    expect(note).not.toContain('color:red');
  });

  it('drops content-less anchor links (GitHub heading permalinks)', () => {
    const note = buildClipNote({
      html: '<div><h2>Why NoPes</h2><a href="#why-nopes" aria-label="Permalink"></a></div><p>Body</p>',
    }, NOW);
    expect(note).toContain('## Why NoPes');
    expect(note).not.toContain('[](#');
  });

  it('converts tables to GFM markdown', () => {
    const note = buildClipNote({
      html: '<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table>',
    }, NOW);
    expect(note).toContain('| Key | Value |');
    expect(note).toContain('| a | 1 |');
  });

  it('renders pre blocks without a code child as fenced code (GitHub highlight)', () => {
    const note = buildClipNote({
      html: '<div class="highlight"><pre>brew install whisper-cpp</pre></div>',
    }, NOW);
    expect(note).toMatch(/```\nbrew install whisper-cpp\n```/);
  });

  it('marks truncated clips', () => {
    const note = buildClipNote({ html: '<p>partial</p>', truncated: true }, NOW);
    expect(note).toContain('partial');
    expect(note).toContain('clip was truncated');
  });

  it('unwraps images that are wrapped in links (GitHub/Wikipedia pattern)', () => {
    const note = buildClipNote({
      html: '<a href="https://x.dev/full.jpg"><img src="https://x.dev/thumb.jpg" alt="Banner"></a>',
    }, NOW);
    expect(note).toContain('![Banner](https://x.dev/thumb.jpg)');
    expect(note).not.toContain('[![');
  });
});

describe('image mirroring helpers', () => {
  it('extracts absolute image URLs from markdown, deduped', async () => {
    const { extractImageUrls } = await import('../clip');
    const md = [
      '![a](https://x.dev/one.png)',
      '![b](https://x.dev/two.jpg "with title")',
      '![a again](https://x.dev/one.png)',
      '![local](assets/already-local.png)',
      '[link](https://x.dev/not-an-image)',
    ].join('\n');
    expect(extractImageUrls(md)).toEqual(['https://x.dev/one.png', 'https://x.dev/two.jpg']);
  });

  it('rewrites image URLs to local asset paths, keeping alt and title', async () => {
    const { rewriteImageLinks } = await import('../clip');
    const md = '![a](https://x.dev/one.png)\n![b](https://x.dev/two.jpg "t")\n![c](https://x.dev/keep.gif)';
    const out = rewriteImageLinks(md, new Map([
      ['https://x.dev/one.png', 'assets/clip-1.png'],
      ['https://x.dev/two.jpg', 'assets/clip-2.jpg'],
    ]));
    expect(out).toContain('![a](assets/clip-1.png)');
    expect(out).toContain('![b](assets/clip-2.jpg "t")');
    expect(out).toContain('![c](https://x.dev/keep.gif)'); // failed download keeps remote URL
  });
});

describe('getClipperToken', () => {
  beforeEach(() => localStorage.clear());
  it('mints a 32-hex token once and reuses it', () => {
    const t1 = getClipperToken();
    expect(t1).toMatch(/^[0-9a-f]{32}$/);
    expect(getClipperToken()).toBe(t1);
  });
});
