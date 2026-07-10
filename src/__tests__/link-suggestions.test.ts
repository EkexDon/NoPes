import { describe, it, expect } from 'vitest';
import { filterLinkSuggestions, isAlreadyLinked, labelForPath } from '../linkSuggestions';

const none = new Set<string>();

describe('labelForPath', () => {
  it('takes the basename without extension', () => {
    expect(labelForPath('/v/sub/Project X.md')).toBe('Project X');
  });
});

describe('isAlreadyLinked', () => {
  it('detects plain and aliased links, case-insensitively', () => {
    expect(isAlreadyLinked('see [[Project X]]', 'project x')).toBe(true);
    expect(isAlreadyLinked('see [[Project X|the proj]]', 'Project X')).toBe(true);
    expect(isAlreadyLinked('mentions Project X in text', 'Project X')).toBe(false);
  });
});

describe('filterLinkSuggestions', () => {
  const hits = [
    { path: '/v/A.md', score: 0.8 },
    { path: '/v/B.md', score: 0.5 },
    { path: '/v/C.md', score: 0.4 },
    { path: '/v/D.md', score: 0.35 },
  ];

  it('sorts by score and caps at max', () => {
    const out = filterLinkSuggestions(hits, '/v/self.md', '', none, { max: 2 });
    expect(out.map(s => s.path)).toEqual(['/v/A.md', '/v/B.md']);
  });

  it('drops the note itself', () => {
    const out = filterLinkSuggestions(hits, '/v/A.md', '', none);
    expect(out.map(s => s.path)).not.toContain('/v/A.md');
  });

  it('drops sub-threshold hits', () => {
    const out = filterLinkSuggestions([{ path: '/v/low.md', score: 0.1 }], null, '', none);
    expect(out).toEqual([]);
  });

  it('drops already-linked targets', () => {
    const out = filterLinkSuggestions(hits, null, 'body with [[A]] linked', none);
    expect(out.map(s => s.label)).not.toContain('A');
    expect(out.map(s => s.label)).toContain('B');
  });

  it('drops dismissed targets', () => {
    const out = filterLinkSuggestions(hits, null, '', new Set(['/v/B.md']));
    expect(out.map(s => s.path)).not.toContain('/v/B.md');
  });

  it('dedupes duplicate paths', () => {
    const out = filterLinkSuggestions(
      [{ path: '/v/A.md', score: 0.9 }, { path: '/v/A.md', score: 0.8 }],
      null, '', none,
    );
    expect(out).toHaveLength(1);
  });

  it('uses the provided label when present', () => {
    const out = filterLinkSuggestions([{ path: '/v/x.md', label: 'Custom', score: 0.9 }], null, '', none);
    expect(out[0].label).toBe('Custom');
  });
});
