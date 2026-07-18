/**
 * vaultIndex.ts — the Vault Index: an incremental, persisted extraction
 * layer over every note. The keystone for the Task Dashboard, unlinked
 * mentions at scale, the weekly digest, and future live queries.
 *
 * Pure extractors first (unit-tested, no I/O), then the VaultIndex class,
 * then a thin persistence layer for `.nopes/index.json`.
 */

import { readTextFile, writeTextFile, mkdir, exists, stat } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { SrsCard, extractCards } from './srs';

/* ────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────── */

export interface TaskEntry {
  notePath: string;
  /** 0-based line number in the note — used to toggle the exact line */
  line: number;
  /** task text with @due()/#tags kept (display strips them) */
  text: string;
  checked: boolean;
  /** ISO date from @due(YYYY-MM-DD), or null */
  due: string | null;
  tags: string[];
}

export interface NoteIndexEntry {
  path: string;
  /** file mtime (ms) at index time — used for reconcile */
  mtime: number;
  tags: string[];
  wikilinks: string[];
  tasks: TaskEntry[];
  frontmatter: Record<string, string>;
  wordCount: number;
  /** spaced-repetition cards ("front ?? back" lines) */
  cards: SrsCard[];
}

// v2: added `cards` — older persisted indexes are rebuilt on load.
export const INDEX_SCHEMA_VERSION = 2;

interface PersistedIndex {
  version: number;
  notes: NoteIndexEntry[];
}

/* ────────────────────────────────────────────────────────────
   Pure extractors
──────────────────────────────────────────────────────────── */

// Same leniency as the Kanban parser: -/*/+ markers optional, empty
// brackets, escaped brackets, missing space after ].
const taskRe = /^(?:[-*+]\s+)?\\?\[( |x)?\\?\]\s*(.+)$/i;
const dueRe = /@due\((\d{4}-\d{2}-\d{2})\)/;
const tagRe = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function extractTaskTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(tagRe)) tags.add(m[2].toLowerCase());
  return [...tags];
}

export function parseDue(text: string): string | null {
  const m = text.match(dueRe);
  if (!m) return null;
  // reject rolled-over dates (2026-99-99)
  const d = new Date(m[1] + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  const [y, mo, day] = m[1].split('-').map(Number);
  if (d.getFullYear() !== y || d.getMonth() + 1 !== mo || d.getDate() !== day) return null;
  return m[1];
}

/** Strip @due()/leading-trailing space for display (tags stay visible). */
export function taskDisplayText(text: string): string {
  return text.replace(dueRe, '').replace(/\s{2,}/g, ' ').trim();
}

export function extractTasks(path: string, content: string): TaskEntry[] {
  const out: TaskEntry[] = [];
  const lines = content.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = trimmed.match(taskRe);
    if (!m || !m[2].trim()) continue;
    const text = m[2].trim();
    out.push({
      notePath: path,
      line: i,
      text,
      checked: (m[1] ?? '').toLowerCase() === 'x',
      due: parseDue(text),
      tags: extractTaskTags(text),
    });
  }
  return out;
}

export function extractWikilinks(content: string): string[] {
  const links = new Set<string>();
  for (const m of content.matchAll(wikilinkRe)) links.add(m[1].trim());
  return [...links];
}

export function extractNoteTags(content: string): string[] {
  // skip fenced code
  const cleaned = content.replace(/```[\s\S]*?(```|$)/g, '');
  return extractTaskTags(cleaned);
}

/** Minimal frontmatter: `key: value` lines between leading --- fences. */
export function extractFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export function indexNote(path: string, content: string, mtime = 0): NoteIndexEntry {
  const tags = extractNoteTags(content);
  return {
    path,
    mtime,
    tags,
    wikilinks: extractWikilinks(content),
    tasks: extractTasks(path, content),
    frontmatter: extractFrontmatter(content),
    wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
    // cards carry their note's tags — decks are built from them
    cards: extractCards(path, content).map(c => ({ ...c, tags })),
  };
}

/**
 * Toggle the checkbox on a specific line. Verification-first: if the line
 * no longer looks like the task we indexed, return null instead of
 * corrupting the note (the index may be a save behind).
 */
export function toggleTaskLine(content: string, line: number, expectText: string): string | null {
  const lines = content.split('\n');
  if (line < 0 || line >= lines.length) return null;
  const m = lines[line].trim().match(taskRe);
  if (!m || m[2].trim() !== expectText) return null;

  const checked = (m[1] ?? '').toLowerCase() === 'x';
  // Replace just the bracket token, preserving marker/indentation style
  lines[line] = lines[line].replace(/\\?\[( |x)?\\?\]/i, checked ? '[ ]' : '[x]');
  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────
   VaultIndex
──────────────────────────────────────────────────────────── */

export class VaultIndex {
  private notes = new Map<string, NoteIndexEntry>();

  get size(): number { return this.notes.size; }

  updateNote(path: string, content: string, mtime = Date.now()): void {
    this.notes.set(path, indexNote(path, content, mtime));
  }

  removeNote(path: string): void {
    this.notes.delete(path);
  }

  renameNote(oldPath: string, newPath: string): void {
    const entry = this.notes.get(oldPath);
    if (!entry) return;
    this.notes.delete(oldPath);
    this.notes.set(newPath, {
      ...entry,
      path: newPath,
      tasks: entry.tasks.map(t => ({ ...t, notePath: newPath })),
      // note: card keys are path-derived; a rename re-keys them (review
      // state follows on the next save/reconcile via extractCards)
      cards: (entry.cards ?? []).map(c => ({ ...c, notePath: newPath })),
    });
  }

  get(path: string): NoteIndexEntry | undefined {
    return this.notes.get(path);
  }

  has(path: string): boolean { return this.notes.has(path); }

  /** Drop entries whose files no longer exist (paths = current vault list). */
  retainOnly(paths: Set<string>): void {
    for (const p of [...this.notes.keys()]) {
      if (!paths.has(p)) this.notes.delete(p);
    }
  }

  allTasks(): TaskEntry[] {
    const out: TaskEntry[] = [];
    for (const entry of this.notes.values()) out.push(...entry.tasks);
    return out;
  }

  allNotes(): NoteIndexEntry[] {
    return [...this.notes.values()];
  }

  allCards(): SrsCard[] {
    const out: SrsCard[] = [];
    for (const entry of this.notes.values()) out.push(...(entry.cards ?? []));
    return out;
  }

  notesModifiedSince(ts: number): NoteIndexEntry[] {
    return [...this.notes.values()].filter(n => n.mtime >= ts);
  }

  toJSON(): PersistedIndex {
    return { version: INDEX_SCHEMA_VERSION, notes: [...this.notes.values()] };
  }

  static fromJSON(data: unknown): VaultIndex {
    const idx = new VaultIndex();
    const parsed = data as PersistedIndex | null;
    if (!parsed || parsed.version !== INDEX_SCHEMA_VERSION || !Array.isArray(parsed.notes)) {
      return idx; // schema mismatch → caller rebuilds
    }
    for (const n of parsed.notes) {
      // entries written by an older extractor (missing fields) are dropped
      // here so reconcile re-reads them with the current extractors
      if (!n?.path || !Array.isArray(n.tasks) || !Array.isArray(n.cards) || !Array.isArray(n.tags)) continue;
      idx.notes.set(n.path, n);
    }
    return idx;
  }
}

/* ────────────────────────────────────────────────────────────
   Persistence & reconcile (Tauri I/O)
──────────────────────────────────────────────────────────── */

async function indexFilePath(vaultPath: string): Promise<string> {
  return await join(vaultPath, '.nopes', 'index.json');
}

export async function loadPersistedIndex(vaultPath: string): Promise<VaultIndex> {
  try {
    const p = await indexFilePath(vaultPath);
    if (await exists(p)) {
      return VaultIndex.fromJSON(JSON.parse(await readTextFile(p)));
    }
  } catch (e) {
    console.warn('[NoPes:index] Could not load persisted index, rebuilding:', e);
  }
  return new VaultIndex();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePersist(vaultPath: string, index: VaultIndex, delayMs = 4000): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const dir = await join(vaultPath, '.nopes');
      await mkdir(dir, { recursive: true });
      await writeTextFile(await indexFilePath(vaultPath), JSON.stringify(index.toJSON()));
    } catch (e) {
      console.warn('[NoPes:index] Persist failed:', e);
    }
  }, delayMs);
}

/**
 * Reconcile the index against the current vault file list: index new files,
 * re-index files whose mtime moved, drop deleted ones. Reads only what
 * actually changed.
 */
export async function reconcileIndex(
  vaultPath: string,
  index: VaultIndex,
  files: { path: string; is_dir?: boolean }[],
): Promise<{ indexed: number; removed: number }> {
  const mdFiles = files.filter(f => !f.is_dir && f.path.toLowerCase().endsWith('.md'));
  const current = new Set(mdFiles.map(f => f.path));
  const before = index.size;
  index.retainOnly(current);
  const removed = before - index.size;

  let indexed = 0;
  let failures = 0;
  for (const f of mdFiles) {
    try {
      // stat is an optimization (skip unchanged files) — if it's ever
      // unavailable (permission regression), fall back to reading the
      // file rather than silently skipping it. A skipped file means an
      // invisible note in Tasks/Review, which reads as data loss.
      let mtime = 0;
      let statOk = false;
      try {
        const info = await stat(f.path);
        mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
        statOk = true;
      } catch { /* fall through to content-based indexing */ }

      const existing = index.get(f.path);
      if (statOk && existing && existing.mtime === mtime) continue;
      if (!statOk && existing) continue; // can't compare — keep existing entry

      const content = await readTextFile(f.path);
      index.updateNote(f.path, content, statOk ? mtime : Date.now());
      indexed++;
    } catch (e) {
      failures++;
      if (failures <= 3) console.error('[NoPes:index] Could not index', f.path, e);
    }
  }
  if (failures > 0) {
    console.error(`[NoPes:index] ${failures}/${mdFiles.length} notes failed to index — Tasks/Review may be incomplete.`);
  }

  if (indexed > 0 || removed > 0) schedulePersist(vaultPath, index);
  return { indexed, removed };
}
