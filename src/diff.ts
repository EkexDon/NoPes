/**
 * diff.ts — minimal line diff for the Version History panel.
 * LCS-based for normal notes; falls back to a cheap prefix/suffix diff
 * beyond a size guard so pathological files can't freeze the UI.
 */

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

const LCS_MAX_LINES = 3000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  if (a.length * b.length > LCS_MAX_LINES * LCS_MAX_LINES) {
    return fallbackDiff(a, b);
  }

  // Standard LCS table
  const m = a.length, n = b.length;
  // Uint32 table keeps memory reasonable (3000² × 4B ≈ 36 MB worst case,
  // guarded above; typical notes are a few hundred lines)
  const table = new Uint32Array((m + 1) * (n + 1));
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[idx(i, j)] = a[i] === b[j]
        ? table[idx(i + 1, j + 1)] + 1
        : Math.max(table[idx(i + 1, j)], table[idx(i, j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++; j++;
    } else if (table[idx(i + 1, j)] >= table[idx(i, j + 1)]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] });
  while (j < n) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** Cheap diff: shared prefix + shared suffix, everything between is del/add. */
function fallbackDiff(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ type: 'same', text: a[i] });
  for (let i = start; i < endA; i++) out.push({ type: 'del', text: a[i] });
  for (let i = start; i < endB; i++) out.push({ type: 'add', text: b[i] });
  for (let i = endA; i < a.length; i++) out.push({ type: 'same', text: a[i] });
  return out;
}

/** Summary counts for a diff — used for the "+12 −3" badge. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}
