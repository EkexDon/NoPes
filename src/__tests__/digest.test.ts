import { describe, it, expect } from 'vitest';
import {
  weekStartOf, digestNoteName, digestWeekFor, buildDigestPrompt, buildDigestNote, DigestStats,
} from '../digest';

describe('weekStartOf', () => {
  it('returns Monday for any weekday', () => {
    // 2026-07-09 is a Thursday → Monday is 2026-07-06
    expect(weekStartOf(new Date(2026, 6, 9)).getDate()).toBe(6);
    // Sunday belongs to the week that started the previous Monday
    expect(weekStartOf(new Date(2026, 6, 12)).getDate()).toBe(6);
    // Monday maps to itself
    expect(weekStartOf(new Date(2026, 6, 6)).getDate()).toBe(6);
  });
});

describe('digestNoteName', () => {
  it('names the note by the week Monday', () => {
    expect(digestNoteName(new Date(2026, 6, 6))).toBe('Your Week — 2026-07-06.md');
  });
});

describe('digestWeekFor', () => {
  it('targets the previous week on a weekday (catch-up)', () => {
    const thursday = new Date(2026, 6, 9, 10, 0);
    const target = digestWeekFor(thursday, null);
    expect(target?.getDate()).toBe(29); // Monday 2026-06-29
    expect(target?.getMonth()).toBe(5);
  });

  it('targets the current week on Sunday evening', () => {
    const sundayEvening = new Date(2026, 6, 12, 19, 0);
    const target = digestWeekFor(sundayEvening, null);
    expect(target?.getDate()).toBe(6);
    expect(target?.getMonth()).toBe(6);
  });

  it('targets the previous week on Sunday morning', () => {
    const sundayMorning = new Date(2026, 6, 12, 9, 0);
    expect(digestWeekFor(sundayMorning, null)?.getDate()).toBe(29);
  });

  it('returns null when that week was already digested', () => {
    const thursday = new Date(2026, 6, 9, 10, 0);
    expect(digestWeekFor(thursday, '2026-06-29')).toBeNull();
    expect(digestWeekFor(thursday, '2026-07-06')).toBeNull(); // even newer
  });

  it('still fires for a newer week than the last digested one', () => {
    const thursday = new Date(2026, 6, 9, 10, 0);
    expect(digestWeekFor(thursday, '2026-06-22')?.getDate()).toBe(29);
  });
});

const STATS: DigestStats = {
  weekStartISO: '2026-06-29',
  weekEndISO: '2026-07-05',
  notes: [
    { name: 'Project X', wordCount: 500, tags: ['work'] },
    { name: 'Garden plan', wordCount: 120, tags: ['home'] },
  ],
  totalWords: 900,
  activeDays: 4,
  openTasks: 7,
  topTags: ['work', 'home'],
};

describe('buildDigestPrompt', () => {
  it('includes week range, stats, and note names', () => {
    const p = buildDigestPrompt(STATS);
    expect(p).toContain('2026-06-29 to 2026-07-05');
    expect(p).toContain('"Project X" (500 words');
    expect(p).toContain('900 words across 4 active day(s)');
    expect(p).toContain('work, home');
  });

  it('handles an empty week gracefully', () => {
    const p = buildDigestPrompt({ ...STATS, notes: [], topTags: [] });
    expect(p).toContain('(no notes were edited this week)');
  });
});

describe('buildDigestNote', () => {
  it('wraps the AI text with title, stats footer, and wikilinks', () => {
    const note = buildDigestNote('You wrote a lot about work.', STATS);
    expect(note).toContain('# Your Week — 2026-06-29');
    expect(note).toContain('You wrote a lot about work.');
    expect(note).toContain('[[Project X]]');
    expect(note).toContain('#work');
    expect(note).toContain('7 open tasks');
  });
});
