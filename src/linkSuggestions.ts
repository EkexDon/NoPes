/**
 * linkSuggestions.ts — pure filtering for AI auto-linking.
 * Semantic hits (from the existing embeddings index) become link
 * suggestions unless they're the note itself, already linked, dismissed,
 * or below the confidence threshold.
 */

export interface SemanticHit {
  path: string;
  label?: string;
  score: number;
}

export interface LinkSuggestion {
  path: string;
  label: string;
  score: number;
}

export const LINK_SUGGESTION_MIN_SCORE = 0.3;

export function labelForPath(path: string): string {
  return path.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? path;
}

/** Case-insensitive check for an existing [[link]] to `label`. */
export function isAlreadyLinked(content: string, label: string): boolean {
  const lower = content.toLowerCase();
  const needle = label.toLowerCase();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    if (m[1].trim() === needle) return true;
  }
  return false;
}

export function filterLinkSuggestions(
  hits: SemanticHit[],
  currentPath: string | null,
  content: string,
  dismissed: Set<string>,
  opts: { max?: number; minScore?: number } = {},
): LinkSuggestion[] {
  const { max = 3, minScore = LINK_SUGGESTION_MIN_SCORE } = opts;
  const out: LinkSuggestion[] = [];
  const seen = new Set<string>();

  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    if (out.length >= max) break;
    if (hit.score < minScore) continue;
    if (hit.path === currentPath) continue;
    if (seen.has(hit.path) || dismissed.has(hit.path)) continue;
    const label = hit.label ?? labelForPath(hit.path);
    if (!label || isAlreadyLinked(content, label)) continue;
    seen.add(hit.path);
    out.push({ path: hit.path, label, score: hit.score });
  }
  return out;
}

/* Per-note dismissals, persisted so suggestions don't nag forever. */
const DISMISSED_KEY = 'nopes_link_dismissed';
const MAX_DISMISSED_NOTES = 200;

export function loadDismissed(notePath: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
    return new Set<string>(all[notePath] ?? []);
  } catch { return new Set(); }
}

export function addDismissed(notePath: string, targetPath: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
    all[notePath] = [...new Set([...(all[notePath] ?? []), targetPath])];
    const keys = Object.keys(all);
    if (keys.length > MAX_DISMISSED_NOTES) {
      for (const k of keys.slice(0, keys.length - MAX_DISMISSED_NOTES)) delete all[k];
    }
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(all));
  } catch { /* storage full — dismissal just won't persist */ }
}
