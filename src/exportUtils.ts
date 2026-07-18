/**
 * exportUtils.ts — helpers for PDF export.
 *
 * html2canvas (inside html2pdf) cannot rasterize <iframe> or <video>, and
 * asset:// image URLs can taint the canvas and blank the entire export.
 * So before exporting we: (1) inline vault images as data URLs, and
 * (2) swap embedded PDFs/videos for labeled placeholders in the clone.
 */

export function mimeFor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

/** Chunked base64 — String.fromCharCode(...allBytes) overflows the stack on big images. */
export function bytesToDataUrl(bytes: Uint8Array, fileName: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mimeFor(fileName)};base64,${btoa(binary)}`;
}

/** Placeholder shown in the PDF where an embedded video/PDF was. */
export function mediaPlaceholderText(kind: 'video' | 'pdf', name: string): string {
  return kind === 'video' ? `🎬 Video: ${name}` : `📄 Embedded PDF: ${name}`;
}

/**
 * Rewrite the export CLONE so html2canvas can render it:
 * - <img> srcs are swapped for pre-computed data URLs (no asset:// taint)
 * - <iframe>/<video> become compact labeled placeholders (html2canvas
 *   renders them as big blank boxes otherwise)
 */
export function prepareCloneForPdf(doc: Document, imageDataUrls: Map<string, string>): void {
  doc.querySelectorAll('img').forEach(img => {
    const rel = (img as HTMLElement).dataset?.relPath;
    const replacement = rel ? imageDataUrls.get(rel) : undefined;
    if (replacement) {
      img.src = replacement;
    } else if (!img.src.startsWith('data:')) {
      // Unresolvable (http offline, missing file) — placeholder text, not a taint risk
      const ph = doc.createElement('div');
      ph.textContent = `🖼 Image: ${rel ?? img.alt ?? 'unavailable'}`;
      ph.setAttribute('style', 'padding:10px 14px;border:1px dashed #999;border-radius:6px;color:#555;font-size:12px;margin:8px 0;');
      img.replaceWith(ph);
    }
  });

  doc.querySelectorAll('iframe, video').forEach(el => {
    const kind = el.tagName.toLowerCase() === 'video' ? 'video' : 'pdf';
    const name =
      (el as HTMLElement).dataset?.relPath?.split(/[/\\]/).pop() ??
      el.getAttribute('title') ??
      el.getAttribute('src')?.split(/[/\\]/).pop() ??
      'attachment';
    const ph = doc.createElement('div');
    ph.textContent = mediaPlaceholderText(kind as 'video' | 'pdf', name);
    ph.setAttribute('style', 'padding:14px 16px;border:1px dashed #999;border-radius:6px;color:#444;font-size:13px;margin:10px 0;background:#f6f6f6;');
    // replace the media's whole wrapper if it only wraps this element
    const wrapper = el.parentElement;
    if (wrapper && wrapper.childElementCount <= 2 && wrapper.tagName === 'DIV') {
      wrapper.replaceWith(ph);
    } else {
      el.replaceWith(ph);
    }
  });
}
