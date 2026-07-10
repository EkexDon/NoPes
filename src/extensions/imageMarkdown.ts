/**
 * imageMarkdown.ts — media-embed round-trip helpers.
 *
 * CommonMark destinations cannot contain raw spaces:
 *   ![](assets/my file.pdf)   ← INVALID — reloads as literal text, then the
 *                                serializer escapes the brackets: corruption.
 * tiptap-markdown's built-in image serializer writes node.attrs.src verbatim
 * (and its parser keeps markdown-it's percent-encoding), so the stable
 * contract is: **store encoded srcs in the document, decode at the point of
 * file access**. `%20` embeds round-trip unchanged (verified by tests) and
 * stay valid in every markdown app.
 */

/** Decode a (possibly percent-encoded) src for filesystem access. */
export function safeDecodeSrc(src: string | null | undefined): string {
  if (!src) return '';
  try {
    return decodeURIComponent(src);
  } catch {
    return src; // malformed % sequences — keep raw
  }
}

/** Encode a vault-relative path for storage in the document (idempotent). */
export function encodeMediaSrc(src: string): string {
  return encodeURI(safeDecodeSrc(src));
}

/** Filenames that survive every layer (markdown, URLs, filesystems). */
export function sanitizeImportFileName(name: string): string {
  return name
    .replace(/[<>#?%"|*\n\r\\/:]/g, '_') // markdown/URL/FS hazards
    .replace(/\s+/g, ' ')
    .trim() || 'file';
}

/**
 * Heal damaged media embeds in raw markdown (runs when a note loads):
 *  - `!\[\](...)`   bracket-escaped corpses of a failed embed → re-embed
 *  - `![](a b.pdf)`  raw spaces in the destination → percent-encoded
 * Fenced code blocks are left untouched.
 */
export function healMediaEmbeds(md: string): string {
  const lines = md.split('\n');
  let inFence = false;
  const embedRe = /!(?:\\\[|\[)((?:[^\]\\]|\\.)*)(?:\\\]|\])\(([^)\n]+)\)/g;

  const healed = lines.map(line => {
    if (line.trim().startsWith('```')) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(embedRe, (full, alt: string, dest: string) => {
      const cleanAlt = alt.replace(/\\([[\]])/g, '$1');
      const cleanDest = dest.trim();
      // only touch embeds that are actually broken (escaped or spaced)
      if (!full.startsWith('!\\[') && !/\s/.test(cleanDest)) return full;
      return `![${cleanAlt}](${encodeMediaSrc(cleanDest)})`;
    });
  });
  return healed.join('\n');
}
