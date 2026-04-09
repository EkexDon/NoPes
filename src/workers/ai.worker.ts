/**
 * ai.worker.ts
 * Runs @huggingface/transformers inference completely off the main thread.
 * Communicates via postMessage / onmessage.
 */
import { pipeline, env } from '@huggingface/transformers';

// Use browser cache (IndexedDB) so the model is only downloaded once
env.allowLocalModels = false;
env.useBrowserCache  = true;

type Embedder = Awaited<ReturnType<typeof pipeline>>;

let embedder: Embedder | null = null;

/** Cosine similarity between two Float32Arrays */
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Mean-pool token embeddings → single sentence vector */
function meanPool(embedTensor: any): Float32Array {
  const data = embedTensor.data as Float32Array;
  const [, seqLen, dim] = embedTensor.dims as number[];
  const out = new Float32Array(dim);
  for (let t = 0; t < seqLen; t++) {
    for (let d = 0; d < dim; d++) {
      out[d] += data[t * dim + d];
    }
  }
  for (let d = 0; d < dim; d++) out[d] /= seqLen;
  // L2-normalize
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += out[d] * out[d];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let d = 0; d < dim; d++) out[d] /= norm;
  return out;
}

async function getEmbedder(): Promise<Embedder> {
  if (!embedder) {
    self.postMessage({ type: 'STATUS', status: 'loading' });
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { dtype: 'q8' }  // quantized: smaller + faster
    );
    self.postMessage({ type: 'STATUS', status: 'ready' });
  }
  return embedder!;
}

async function embed(text: string): Promise<Float32Array> {
  const e = await getEmbedder();
  const output = await (e as any)(text.slice(0, 512), { pooling: 'mean', normalize: true });
  // output is a Tensor: try to get data directly
  if (output.data instanceof Float32Array) return output.data as Float32Array;
  // fallback: mean-pool ourselves
  return meanPool(output);
}

// ── Message Handler ──────────────────────────────────────
self.onmessage = async (event: MessageEvent) => {
  const { type, id } = event.data;

  try {
    if (type === 'INIT') {
      await getEmbedder();
      self.postMessage({ type: 'INIT_OK', id });

    } else if (type === 'EMBED_QUERY') {
      // Embed a single search query
      const { text } = event.data as { text: string; id: string };
      const vec = await embed(text);
      self.postMessage({ type: 'EMBED_QUERY_OK', id, vec }, { transfer: [vec.buffer] });

    } else if (type === 'EMBED_DOCS') {
      // Embed an array of { path, text } documents
      const { docs } = event.data as { docs: { path: string; text: string }[]; id: string };
      const results: { path: string; vec: Float32Array }[] = [];
      for (const doc of docs) {
        const vec = await embed(doc.text);
        results.push({ path: doc.path, vec });
        self.postMessage({ type: 'EMBED_PROGRESS', done: results.length, total: docs.length });
      }
      // Transfer all buffers in one go
      const transferables = results.map(r => r.vec.buffer);
      self.postMessage({ type: 'EMBED_DOCS_OK', id, results }, { transfer: transferables });

    } else if (type === 'SEARCH') {
      // Semantic search: rank stored embeddings against query embedding
      const { queryVec, index, topK } = event.data as {
        queryVec: Float32Array;
        index: { path: string; label: string; vec: Float32Array }[];
        topK: number;
        id: string;
      };
      const scored = index.map(entry => ({
        path: entry.path,
        label: entry.label,
        score: cosineSim(queryVec, entry.vec),
      }));
      scored.sort((a, b) => b.score - a.score);
      self.postMessage({ type: 'SEARCH_OK', id, results: scored.slice(0, topK) });
    }

  } catch (err: any) {
    self.postMessage({ type: 'ERROR', id, error: err?.message ?? String(err) });
  }
};
