/**
 * history.ts — Version History ("Time Machine") for notes.
 *
 * Shadow-copy snapshots live in `<vault>/.nopes/history/<key>/<stamp>.md`.
 * Deliberately NOT git: vaults are often already git repos, and a nested
 * `.git` is a trust hazard. Shadow copies are dumb, predictable, and prunable.
 *
 * Pure logic (naming, parsing, pruning plans) is exported separately from the
 * filesystem layer so it can be unit-tested without Tauri.
 */

import { readTextFile, writeTextFile, readDir, mkdir, remove, exists, rename } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

/* ────────────────────────────────────────────────────────────
   Pure core
──────────────────────────────────────────────────────────── */

/** Minimum time between automatic snapshots of the same note. */
export const SNAPSHOT_MIN_INTERVAL_MS = 60_000;

/** djb2 — tiny, stable string hash for filename-safe uniqueness. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Stable directory key for a note: readable slug from the vault-relative
 * path + short hash (so truncation or odd characters can't collide).
 */
export function historyKeyFor(vaultPath: string, notePath: string): string {
  const rel = notePath.replace(vaultPath, '').replace(/^[/\\]/, '');
  const slug = rel
    .replace(/\.md$/i, '')
    .replace(/[/\\]/g, '__')
    .replace(/[^a-zA-Z0-9_\-. ]/g, '_')
    .slice(0, 80);
  return `${slug}-${hashString(rel)}`;
}

/** Filesystem-safe local-time stamp: 2026-07-09T14-30-05 */
export function snapshotStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Inverse of snapshotStamp. Returns null for foreign filenames. */
export function parseSnapshotStamp(name: string): Date | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:\.md)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  if (isNaN(date.getTime())) return null;
  // JS Date silently rolls invalid components over (month 99 → year+8);
  // a round-trip check rejects those.
  return snapshotStamp(date) === name.replace(/\.md$/, '') ? date : null;
}

/**
 * Pruning policy over snapshot dates (all for the same note):
 *   - keep everything from the last hour
 *   - keep one per hour for the last 24 h
 *   - keep one per day for the last 31 days
 *   - keep one per ISO-week beyond that (history never fully vanishes)
 * Within a bucket the NEWEST snapshot wins.
 * Returns the dates to remove.
 */
export function planPruning(dates: Date[], now: Date): Date[] {
  const HOUR = 3_600_000, DAY = 86_400_000;
  const keep = new Set<number>();
  const buckets = new Map<string, Date>();

  const sorted = [...dates].sort((a, b) => b.getTime() - a.getTime());
  for (const d of sorted) {
    const age = now.getTime() - d.getTime();
    let bucket: string;
    if (age <= HOUR) {
      keep.add(d.getTime());
      continue;
    } else if (age <= 24 * HOUR) {
      bucket = `h-${Math.floor(d.getTime() / HOUR)}`;
    } else if (age <= 31 * DAY) {
      bucket = `d-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    } else {
      // ISO-ish week bucket: days since epoch / 7
      bucket = `w-${Math.floor(d.getTime() / (7 * DAY))}`;
    }
    const existing = buckets.get(bucket);
    if (!existing || d.getTime() > existing.getTime()) {
      buckets.set(bucket, d);
    }
  }
  for (const d of buckets.values()) keep.add(d.getTime());

  return dates.filter(d => !keep.has(d.getTime()));
}

/* ────────────────────────────────────────────────────────────
   Filesystem layer
──────────────────────────────────────────────────────────── */

export interface SnapshotInfo {
  /** absolute path of the snapshot file */
  path: string;
  date: Date;
}

const lastSnapshotAt = new Map<string, number>();

async function historyDirFor(vaultPath: string, notePath: string): Promise<string> {
  const key = historyKeyFor(vaultPath, notePath);
  return await join(vaultPath, '.nopes', 'history', key);
}

/** List snapshots for a note, newest first. Missing dir → empty list. */
export async function listSnapshots(vaultPath: string, notePath: string): Promise<SnapshotInfo[]> {
  const dir = await historyDirFor(vaultPath, notePath);
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  const infos: SnapshotInfo[] = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    const date = parseSnapshotStamp(e.name.replace(/\.md$/, ''));
    if (!date) continue;
    infos.push({ path: await join(dir, e.name), date });
  }
  return infos.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function readSnapshot(snapshotPath: string): Promise<string> {
  return await readTextFile(snapshotPath);
}

/**
 * Snapshot the note's CURRENT on-disk content (the state about to be
 * overwritten). Rate-limited per note unless `force` is set. Never throws —
 * history must not be able to break saving.
 */
export async function maybeSnapshotNote(
  vaultPath: string | null,
  notePath: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!vaultPath || !notePath.toLowerCase().endsWith('.md')) return;
  // Never snapshot our own history/internal files
  if (notePath.includes('/.nopes/') || notePath.includes('\\.nopes\\')) return;

  try {
    const key = historyKeyFor(vaultPath, notePath);
    const now = Date.now();

    if (!opts.force) {
      let last = lastSnapshotAt.get(key);
      if (last === undefined) {
        // Cold start: consult the newest existing snapshot
        const existing = await listSnapshots(vaultPath, notePath);
        last = existing[0]?.date.getTime() ?? 0;
        lastSnapshotAt.set(key, last);
      }
      if (now - last < SNAPSHOT_MIN_INTERVAL_MS) return;
    }

    if (!(await exists(notePath))) return; // first save — nothing to protect yet
    const current = await readTextFile(notePath);
    if (!current.trim()) return; // empty file isn't worth a snapshot

    const dir = await historyDirFor(vaultPath, notePath);
    await mkdir(dir, { recursive: true });
    const file = await join(dir, `${snapshotStamp(new Date())}.md`);
    await writeTextFile(file, current);
    lastSnapshotAt.set(key, now);

    // Prune opportunistically
    const all = await listSnapshots(vaultPath, notePath);
    const toRemove = planPruning(all.map(s => s.date), new Date());
    const removeTimes = new Set(toRemove.map(d => d.getTime()));
    for (const snap of all) {
      if (removeTimes.has(snap.date.getTime())) {
        await remove(snap.path).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[NoPes:history] Snapshot failed (saving continues):', e);
  }
}

/**
 * Carry a note's history along when the note is renamed or moved,
 * so "restore" still finds it. Best-effort — never throws.
 */
export async function moveHistory(vaultPath: string | null, oldPath: string, newPath: string): Promise<void> {
  if (!vaultPath) return;
  try {
    const oldDir = await historyDirFor(vaultPath, oldPath);
    if (!(await exists(oldDir))) return;
    const newDir = await historyDirFor(vaultPath, newPath);
    const parent = await join(vaultPath, '.nopes', 'history');
    await mkdir(parent, { recursive: true });
    if (!(await exists(newDir))) {
      await rename(oldDir, newDir);
    }
    lastSnapshotAt.delete(historyKeyFor(vaultPath, oldPath));
  } catch (e) {
    console.warn('[NoPes:history] Could not migrate history on rename:', e);
  }
}
