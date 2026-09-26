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
let embedderPromise: Promise<Embedder> | null = null;
let searchIndex: { path: string; label: string; vec: Float32Array }[] = [];

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
  if (embedder) return embedder;
  if (!embedderPromise) {
    self.postMessage({ type: 'STATUS', status: 'loading' });
    embedderPromise = pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { dtype: 'q8' }
    ).then(model => {
      embedder = model;
      self.postMessage({ type: 'STATUS', status: 'ready' });
      return model;
    }).catch(error => {
      embedderPromise = null;
      throw error;
    });
  }
  return embedderPromise;
}

async function embed(text: string): Promise<Float32Array> {
  const e = await getEmbedder();
  const output = await (e as any)(text.slice(0, 512), { pooling: 'mean', normalize: true });
  // output is a Tensor: try to get data directly
  if (output.data instanceof Float32Array) return output.data as Float32Array;
  // fallback: mean-pool ourselves
  return meanPool(output);
}

function noteText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?(?:\[[^\]]*\])\([^)]*\)/g, ' ')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function summarizeLocally(text: string): Promise<string> {
  const sentences = noteText(text)
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(sentence => sentence.trim()).filter(sentence => sentence.length >= 24).slice(0, 6) ?? [];
  if (sentences.length === 0) return noteText(text).slice(0, 220);
  if (sentences.length === 1) return sentences[0];
  const vectors: Float32Array[] = [];
  for (const sentence of sentences) vectors.push(await embed(sentence));
  const centroid = new Float32Array(vectors[0].length);
  vectors.forEach(vector => vector.forEach((value, index) => { centroid[index] += value / vectors.length; }));
  const best = sentences.reduce((bestIndex, sentence, index) =>
    sentence.length <= 240 && cosineSim(vectors[index], centroid) > cosineSim(vectors[bestIndex], centroid) ? index : bestIndex, 0);
  return sentences[best];
}

function suggestTagsLocally(text: string, existingTags: string[]): string[] {
  const existing = new Set(existingTags.map(tag => tag.toLowerCase()));
  const ignored = new Set(['about', 'after', 'again', 'also', 'and', 'are', 'been', 'being', 'between', 'but', 'can', 'could', 'did', 'does', 'each', 'every', 'for', 'from', 'have', 'into', 'its', 'just', 'more', 'most', 'not', 'note', 'notes', 'only', 'other', 'our', 'over', 'professional', 'should', 'some', 'such', 'than', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'using', 'very', 'was', 'what', 'when', 'which', 'while', 'with', 'would', 'you', 'your']);
  const counts = new Map<string, number>();
  for (const word of noteText(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? []) {
    if (!ignored.has(word) && !existing.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([word]) => word);
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

    } else if (type === 'SUMMARIZE') {
      const { text } = event.data as { text: string; id: string };
      self.postMessage({ type: 'GENERATION_PROGRESS', message: 'Finding the key idea locally…' });
      const summary = await summarizeLocally(text);
      self.postMessage({ type: 'SUMMARIZE_OK', id, summary });

    } else if (type === 'GENERATE_TAGS') {
      const { text, existingTags = [] } = event.data as { text: string; existingTags?: string[]; id: string };
      self.postMessage({ type: 'GENERATION_PROGRESS', message: 'Finding tags locally…' });
      self.postMessage({ type: 'GENERATE_TAGS_OK', id, tags: suggestTagsLocally(text, existingTags) });

    } else if (type === 'SET_INDEX') {
      const { index } = event.data as {
        index: { path: string; label: string; vec: Float32Array }[];
        id: string;
      };
      searchIndex = index;
      self.postMessage({ type: 'SET_INDEX_OK', id });

    } else if (type === 'SEARCH') {
      // Semantic search: rank stored embeddings against query embedding
      const { queryVec, topK } = event.data as {
        queryVec: Float32Array;
        topK: number;
        id: string;
      };
      const scored = searchIndex.map(entry => ({
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
