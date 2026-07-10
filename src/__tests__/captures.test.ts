import { describe, it, expect } from 'vitest';
import { appendCapture, formatCaptureLine, dailyNoteName, CAPTURES_HEADING } from '../captures';

const at = new Date(2026, 6, 9, 14, 5, 0); // 2026-07-09 14:05

describe('dailyNoteName', () => {
  it('formats local date with padding', () => {
    expect(dailyNoteName(at)).toBe('2026-07-09.md');
    expect(dailyNoteName(new Date(2026, 0, 3))).toBe('2026-01-03.md');
  });
});

describe('formatCaptureLine', () => {
  it('stamps the time and bullets the text', () => {
    expect(formatCaptureLine('call the dentist', at)).toBe('- **14:05** call the dentist');
  });

  it('indents continuation lines of a multi-line capture', () => {
    expect(formatCaptureLine('idea:\nmore detail', at)).toBe('- **14:05** idea:\n  more detail');
  });
});

describe('appendCapture', () => {
  it('creates a full daily note from nothing', () => {
    const out = appendCapture(null, 'first thought', at);
    expect(out).toBe(`# 2026-07-09\n\n${CAPTURES_HEADING}\n- **14:05** first thought\n`);
  });

  it('treats whitespace-only content as empty', () => {
    const out = appendCapture('  \n ', 'x', at);
    expect(out).toContain('# 2026-07-09');
  });

  it('appends a captures section to an existing note without one', () => {
    const out = appendCapture('# 2026-07-09\n\nJournal text.', 'a thought', at);
    expect(out).toContain('Journal text.');
    expect(out).toContain(`${CAPTURES_HEADING}\n- **14:05** a thought`);
    expect(out.indexOf('Journal text.')).toBeLessThan(out.indexOf(CAPTURES_HEADING));
  });

  it('appends into an existing captures section, before the next heading', () => {
    const existing = [
      '# 2026-07-09',
      '',
      CAPTURES_HEADING,
      '- **09:00** earlier thought',
      '',
      '## Notes',
      'body',
    ].join('\n');
    const out = appendCapture(existing, 'later thought', at);
    const lines = out.split('\n');
    const idx = lines.indexOf('- **14:05** later thought');
    expect(idx).toBeGreaterThan(lines.indexOf('- **09:00** earlier thought'));
    expect(idx).toBeLessThan(lines.indexOf('## Notes'));
  });

  it('keeps existing content byte-for-byte outside the insertion', () => {
    const existing = '# 2026-07-09\n\nPrecious prose.\n';
    const out = appendCapture(existing, 'new', at);
    expect(out).toContain('Precious prose.');
    expect(out.startsWith('# 2026-07-09')).toBe(true);
  });

  it('two captures stack in order', () => {
    const one = appendCapture(null, 'first', at);
    const two = appendCapture(one, 'second', new Date(2026, 6, 9, 15, 0));
    const lines = two.split('\n');
    expect(lines.indexOf('- **14:05** first')).toBeLessThan(lines.indexOf('- **15:00** second'));
  });
});
