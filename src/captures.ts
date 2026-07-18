/**
 * captures.ts — pure formatting for Global Quick Capture.
 * Captures land in today's daily note (YYYY-MM-DD.md at the vault root,
 * the same convention JournalView uses) under a "📥 Captures" section.
 */

export const CAPTURES_HEADING = '## 📥 Captures';

export function dailyNoteName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.md`;
}

export function formatCaptureLine(text: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(d.getHours())}:${p(d.getMinutes())}`;
  // multi-line captures: first line carries the timestamp, the rest indents
  const lines = text.trim().split('\n');
  const first = `- **${stamp}** ${lines[0]}`;
  const rest = lines.slice(1).map(l => `  ${l}`);
  return [first, ...rest].join('\n');
}

/**
 * Append a capture to (possibly empty/missing) daily-note content.
 * - No content yet → create `# YYYY-MM-DD` + captures section.
 * - Section exists → append at the section's end (before the next heading).
 * - No section yet → append the section at the end of the note.
 */
export function appendCapture(existing: string | null, text: string, d: Date): string {
  const line = formatCaptureLine(text, d);

  if (!existing || !existing.trim()) {
    const title = dailyNoteName(d).replace(/\.md$/, '');
    return `# ${title}\n\n${CAPTURES_HEADING}\n${line}\n`;
  }

  const lines = existing.split('\n');
  const headingIdx = lines.findIndex(l => l.trim() === CAPTURES_HEADING);

  if (headingIdx === -1) {
    return existing.replace(/\n*$/, '\n') + `\n${CAPTURES_HEADING}\n${line}\n`;
  }

  // find end of the captures section: next heading or EOF
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i].trim())) { end = i; break; }
  }
  // insert before trailing blank lines of the section
  let insertAt = end;
  while (insertAt > headingIdx + 1 && !lines[insertAt - 1].trim()) insertAt--;

  const out = [...lines];
  out.splice(insertAt, 0, ...line.split('\n'));
  return out.join('\n');
}
