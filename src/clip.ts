/**
 * clip.ts — pure builders for the Web Clipper intake.
 */

export interface ClipPayload {
  title?: string;
  url?: string;
  selection?: string;
}

/** Filesystem-safe note name from a page title. */
export function clipNoteName(title: string | undefined, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const fallback = `Clip ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
  const cleaned = (title ?? '')
    .replace(/[/\\:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned || fallback}.md`;
}

export function buildClipNote(payload: ClipPayload, now: Date): string {
  const title = payload.title?.trim() || 'Web Clip';
  const lines = [
    `# ${title}`,
    '',
    `> 🔗 Clipped from ${payload.url ?? 'the web'} on ${now.toLocaleString()}`,
    '',
  ];
  const selection = payload.selection?.trim();
  if (selection) {
    lines.push(selection, '');
  }
  if (payload.url) {
    lines.push(`[Source](${payload.url})`, '');
  }
  lines.push('#clipped');
  return lines.join('\n') + '\n';
}

const TOKEN_KEY = 'nopes_clipper_token';

/** Get (or mint) the clipper token. 32 hex chars from the CSPRNG. */
export function getClipperToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token || token.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    token = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}
