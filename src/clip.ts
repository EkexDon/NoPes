/**
 * clip.ts — pure builders for the Web Clipper intake.
 */

import TurndownService from 'turndown';
// @ts-expect-error — turndown-plugin-gfm ships no types
import { gfm } from 'turndown-plugin-gfm';

export interface ClipPayload {
  title?: string;
  url?: string;
  /** Plain-text fallback (older extension versions send only this). */
  selection?: string;
  /** Selection/page HTML — converted to Markdown so structure and images survive. */
  html?: string;
  /** True when the extension had to cut the HTML to fit the intake limit. */
  truncated?: boolean;
  /** True when the browser refused script injection (chrome://, Web Store, PDF viewer…). */
  captureBlocked?: boolean;
  /** Extension version, sent since 1.3.0 — lets the app detect stale installs. */
  clipperVersion?: string;
}

let turndown: TurndownService | null = null;

/** HTML → Markdown, preserving headings, lists, tables, emphasis, links, and images. */
export function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });
    turndown.use(gfm); // tables, strikethrough, task lists
    turndown.remove(['script', 'style', 'noscript']);
    // Heading permalink anchors (GitHub & friends) have no content and
    // would render as [](#…) garbage.
    turndown.addRule('dropEmptyLinks', {
      filter: (node) =>
        node.nodeName === 'A' &&
        !(node.textContent ?? '').trim() &&
        !(node as HTMLElement).querySelector('img'),
      replacement: () => '',
    });
    // GitHub renders code blocks as <pre> without a <code> child, which
    // the default fenced rule does not catch.
    turndown.addRule('preWithoutCode', {
      filter: (node) =>
        node.nodeName === 'PRE' && !(node as HTMLElement).querySelector('code'),
      replacement: (_content, node) =>
        '\n\n```\n' + ((node.textContent ?? '').replace(/\n$/, '')) + '\n```\n\n',
    });
    // Sites wrap images in links to a full-size/detail view ([![…](img)](href)).
    // The wrapper trips TipTap's block-image rendering — keep just the image.
    turndown.addRule('unwrapLinkedImages', {
      filter: (node) =>
        node.nodeName === 'A' &&
        !(node.textContent ?? '').trim() &&
        (node as HTMLElement).querySelectorAll('img').length === 1,
      replacement: (content) => content,
    });
  }
  try {
    return turndown.turndown(html).trim();
  } catch {
    return '';
  }
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
  // Prefer structured HTML (keeps headings, lists, links, images);
  // fall back to the plain-text selection.
  const structured = payload.html ? htmlToMarkdown(payload.html) : '';
  const body = structured || payload.selection?.trim();
  if (body) {
    lines.push(body, '');
  }
  if (payload.truncated) {
    lines.push('> ⚠️ This clip was truncated — the page was too large to capture fully.', '');
  }
  if (payload.url) {
    lines.push(`[Source](${payload.url})`, '');
  }
  lines.push('#clipped');
  return lines.join('\n') + '\n';
}

/* ── Image mirroring ──────────────────────────────────────────
   Clipped notes reference remote images; those links rot and leak
   requests on every note open. saveClip downloads them into the
   vault's assets/ dir and rewrites the note to local paths. */

const MD_IMAGE = /!\[([^\]]*)\]\((\S+?)((?:\s+"[^"]*")?)\)/g;

/** All distinct http(s) image URLs referenced by the markdown. */
export function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  for (const m of markdown.matchAll(MD_IMAGE)) {
    const url = m[2];
    if (/^https?:\/\//.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Swap remote image URLs for local asset paths; unmapped URLs stay remote. */
export function rewriteImageLinks(markdown: string, mapping: Map<string, string>): string {
  return markdown.replace(MD_IMAGE, (full, alt, url, title) => {
    const local = mapping.get(url);
    return local ? `![${alt}](${local}${title})` : full;
  });
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
