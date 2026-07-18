/**
 * localImage.ts — paints vault-local images from blob: URLs.
 *
 * The asset:// custom protocol intermittently renders a blank box in
 * WKWebView, and `loading="lazy"` on script-inserted images inside the
 * editor's scroll container can wedge the load entirely (the image never
 * fetches). Reading the bytes through the fs plugin and handing the
 * browser a blob: URL sidesteps both layers — the same machinery every
 * other file feature in the app already relies on.
 */

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
};

/** MIME from the file extension — SVG in particular only renders in an
    <img> when the blob carries the correct type. */
export function imageMimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME[ext] ?? 'application/octet-stream';
}

type ReadBytes = (absPath: string) => Promise<Uint8Array>;

const defaultReader: ReadBytes = async (absPath) => {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return readFile(absPath);
};

/** absPath → blob: URL, in insertion order (oldest first) for LRU eviction. */
const cache = new Map<string, string>();
const CACHE_MAX = 60;

/**
 * Blob URL for a local image file. Cached (LRU, capped) and retried once —
 * a transient read failure must not leave a permanently blank image.
 */
export async function localImageUrl(absPath: string, readBytes: ReadBytes = defaultReader): Promise<string> {
  const hit = cache.get(absPath);
  if (hit) {
    cache.delete(absPath);
    cache.set(absPath, hit); // bump to most-recently-used
    return hit;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const bytes = await readBytes(absPath);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMimeFor(absPath) }));
      cache.set(absPath, url);
      if (cache.size > CACHE_MAX) {
        // Safe to revoke: an already-painted <img> keeps its decoded bitmap —
        // revocation only stops future loads, which re-read from disk.
        const oldest = cache.entries().next().value;
        if (oldest) {
          cache.delete(oldest[0]);
          URL.revokeObjectURL(oldest[1]);
        }
      }
      return url;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Test hook: drop every cached URL. */
export function clearLocalImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
