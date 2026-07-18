/**
 * ocr.ts — on-device OCR via tesseract.js with LOCALLY BUNDLED assets.
 * Worker, wasm core, and English+German traineddata ship in public/ocr/ —
 * zero CDN requests, per the local-first moat.
 *
 * On-demand by design: an OCR button on images in the editor extracts the
 * text and inserts it below the image, where it's naturally searchable.
 */

export function cleanOcrText(raw: string): string {
  return raw
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    // drop lines that are mostly OCR noise (no letters/digits)
    .filter(l => (l.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= Math.max(2, l.length * 0.3))
    .join('\n')
    .trim();
}

let workerPromise: Promise<any> | null = null;

async function getOcrWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      // eng+deu: the user writes in both languages
      return await createWorker(['eng', 'deu'], 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
        langPath: '/ocr',
        gzip: false, // bundled traineddata is uncompressed
        logger: () => {},
      });
    })().catch(err => {
      workerPromise = null; // allow retry after a failure
      throw err;
    });
  }
  return workerPromise;
}

/** Recognize text in an image (Blob or object URL). Returns cleaned text. */
export async function recognizeImage(image: Blob | string): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(image);
  return cleanOcrText(data?.text ?? '');
}

/** Free the worker (it holds ~100 MB of wasm heap). */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* already gone */ }
  workerPromise = null;
}
