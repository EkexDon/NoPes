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
});

describe('getClipperToken', () => {
  beforeEach(() => localStorage.clear());
  it('mints a 32-hex token once and reuses it', () => {
    const t1 = getClipperToken();
    expect(t1).toMatch(/^[0-9a-f]{32}$/);
    expect(getClipperToken()).toBe(t1);
  });
});
