import { describe, it, expect } from 'vitest';
import {
  hashString, historyKeyFor, snapshotStamp, parseSnapshotStamp, planPruning,
} from '../history';
import { diffLines, diffStats } from '../diff';

describe('history core', () => {
  it('hashString is stable and filename-safe', () => {
    expect(hashString('notes/foo.md')).toBe(hashString('notes/foo.md'));
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('ünïcödé/pfad.md')).toMatch(/^[a-z0-9]+$/);
  });

  it('historyKeyFor distinguishes same-named notes in different folders', () => {
    const v = '/vault';
    expect(historyKeyFor(v, '/vault/a/Note.md')).not.toBe(historyKeyFor(v, '/vault/b/Note.md'));
  });

  it('historyKeyFor truncates long paths but stays unique via hash', () => {
    const v = '/vault';
    const long = '/vault/' + 'x'.repeat(300) + '/Note.md';
    const long2 = '/vault/' + 'x'.repeat(300) + '/Other.md';
    const k1 = historyKeyFor(v, long);
    const k2 = historyKeyFor(v, long2);
    expect(k1.length).toBeLessThan(100);
    expect(k1).not.toBe(k2);
  });

  it('snapshotStamp round-trips through parseSnapshotStamp', () => {
    const d = new Date(2026, 6, 9, 14, 30, 5);
    const parsed = parseSnapshotStamp(snapshotStamp(d));
    expect(parsed?.getTime()).toBe(d.getTime());
  });

  it('parseSnapshotStamp rejects foreign filenames', () => {
    expect(parseSnapshotStamp('notes.md')).toBeNull();
    expect(parseSnapshotStamp('.DS_Store')).toBeNull();
    expect(parseSnapshotStamp('2026-99-99T99-99-99')).toBeNull();
  });
});

describe('planPruning', () => {
  const now = new Date(2026, 6, 9, 12, 0, 0);
  const min = (n: number) => new Date(now.getTime() - n * 60_000);
  const hr = (n: number) => new Date(now.getTime() - n * 3_600_000);
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('keeps everything from the last hour', () => {
    const dates = [min(1), min(10), min(30), min(59)];
    expect(planPruning(dates, now)).toEqual([]);
  });

  it('keeps one per hour within the last day', () => {
    // three snapshots inside the same epoch-hour bucket, ~3.5 hours ago
    // → keep newest only. Align to a bucket start so the trio can't
    // straddle an hour boundary.
    const HOUR = 3_600_000;
    const bucketStart = (Math.floor(now.getTime() / HOUR) - 4) * HOUR;
    const d1 = new Date(bucketStart + 30 * 60_000);
    const d2 = new Date(bucketStart + 20 * 60_000);
    const d3 = new Date(bucketStart + 10 * 60_000);
    const removed = planPruning([d1, d2, d3], now);
    expect(removed).toContainEqual(d2);
    expect(removed).toContainEqual(d3);
    expect(removed).not.toContainEqual(d1);
  });

  it('keeps one per day within the last month', () => {
    const morning = new Date(2026, 6, 4, 9, 0, 0);
    const noon    = new Date(2026, 6, 4, 12, 0, 0);
    const evening = new Date(2026, 6, 4, 20, 0, 0);
    const removed = planPruning([morning, noon, evening], now);
    // newest of the day survives
    expect(removed).toContainEqual(morning);
    expect(removed).toContainEqual(noon);
    expect(removed).not.toContainEqual(evening);
  });

  it('keeps one per week beyond a month — history never fully vanishes', () => {
    const old1 = day(60);
    const old2 = new Date(old1.getTime() - 86_400_000);     // same week
    const veryOld = day(120);
    const removed = planPruning([old1, old2, veryOld], now);
    expect(removed).toContainEqual(old2);
    expect(removed).not.toContainEqual(old1);
    expect(removed).not.toContainEqual(veryOld);
  });

  it('handles empty input', () => {
    expect(planPruning([], now)).toEqual([]);
  });

  it('never removes what it keeps (sanity over a spread of ages)', () => {
    const dates = [min(5), hr(2), hr(5), hr(30), day(3), day(10), day(45), day(100)];
    const removed = new Set(planPruning(dates, now).map(d => d.getTime()));
    const kept = dates.filter(d => !removed.has(d.getTime()));
    expect(kept.length + removed.size).toBe(dates.length);
    expect(kept.length).toBeGreaterThan(0);
  });
});

describe('diffLines', () => {
  it('reports identical texts as all-same', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.every(l => l.type === 'same')).toBe(true);
  });

  it('detects an added line', () => {
    const d = diffLines('a\nc', 'a\nb\nc');
    expect(d).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('detects a removed line', () => {
    const d = diffLines('a\nb\nc', 'a\nc');
    expect(d.filter(l => l.type === 'del')).toEqual([{ type: 'del', text: 'b' }]);
  });

  it('detects a changed line as del+add', () => {
    const d = diffLines('hello world', 'hello there');
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
  });

  it('handles empty sides', () => {
    expect(diffLines('', 'a').some(l => l.type === 'add')).toBe(true);
    expect(diffLines('a', '').some(l => l.type === 'del')).toBe(true);
  });

  it('survives large inputs via the fallback path', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const changed = big.replace('line 2500', 'line 2500 CHANGED');
    const d = diffLines(big, changed);
    const stats = diffStats(d);
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(1);
  });
});
