/**
 * queryEngine.ts — the filter engine behind ```nopes-query``` blocks.
 *
 * Deliberately NOT a DSL (decision log #8): flat `key=value` filters cover
 * the real use cases without a parser to maintain.
 *
 *   tag=#project status=active has=tasks name=meeting sort=modified limit=10
 *
 * - `tag=x` / `tag=#x`  → note contains the tag
 * - `has=tasks|cards|links` → structural presence
 * - `name=substr`       → note name contains (case-insensitive)
 * - anything else       → frontmatter key equals value (case-insensitive)
 * - `sort=modified|name|words` (modified desc, name asc, words desc)
 * - `limit=N` (default 50)
 */

import type { NoteIndexEntry } from './vaultIndex';

export interface ParsedQuery {
  filters: { key: string; value: string }[];
  sort: 'modified' | 'name' | 'words';
  limit: number;
}

export const QUERY_DEFAULT_LIMIT = 50;

export function parseQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { filters: [], sort: 'modified', limit: QUERY_DEFAULT_LIMIT };
  for (const token of q.split(/\s+/)) {
    if (!token.trim()) continue;
    const eq = token.indexOf('=');
    if (eq <= 0) continue; // bare tokens are ignored, not errors
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = token.slice(eq + 1).trim();
    if (!value) continue;
    if (key === 'sort') {
      if (value === 'modified' || value === 'name' || value === 'words') parsed.sort = value;
    } else if (key === 'limit') {
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n > 0) parsed.limit = Math.min(n, 500);
    } else {
      parsed.filters.push({ key, value });
    }
  }
  return parsed;
}

export function noteName(entry: NoteIndexEntry): string {
  return entry.path.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? entry.path;
}

function matches(entry: NoteIndexEntry, key: string, value: string): boolean {
  const v = value.toLowerCase();
  switch (key) {
    case 'tag':
      return entry.tags.includes(v.replace(/^#/, ''));
    case 'has':
      if (v === 'tasks') return entry.tasks.length > 0;
      if (v === 'cards') return (entry.cards ?? []).length > 0;
      if (v === 'links') return entry.wikilinks.length > 0;
      return false;
    case 'name':
      return noteName(entry).toLowerCase().includes(v);
    default: {
      const fm = entry.frontmatter?.[key];
      return fm !== undefined && fm.toLowerCase() === v;
    }
  }
}

export function runQuery(notes: NoteIndexEntry[], queryString: string): NoteIndexEntry[] {
  const q = parseQuery(queryString);
  let out = notes.filter(n => q.filters.every(f => matches(n, f.key, f.value)));

  if (q.sort === 'modified') out = out.sort((a, b) => b.mtime - a.mtime);
  else if (q.sort === 'name') out = out.sort((a, b) => noteName(a).localeCompare(noteName(b)));
  else out = out.sort((a, b) => b.wordCount - a.wordCount);

  return out.slice(0, q.limit);
}
