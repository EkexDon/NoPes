/**
 * AIService.ts
 * Singleton that manages the ai.worker.ts Web Worker.
 * Exposes promise-based API so callers don't deal with postMessage directly.
 */

let worker: Worker | null = null;
let pendingCallbacks: Map<string, { resolve: (v: any) => void; reject: (e: any) => void }> = new Map();
let statusListeners: ((status: 'idle' | 'loading' | 'ready' | 'error') => void)[] = [];
let progressListeners: ((done: number, total: number) => void)[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('[AIService] Idle timeout reached. Terminating worker to save memory.');
    AIService.terminate();
  }, IDLE_TIMEOUT);
}

function getWorker(): Worker {
  if (!worker) {
    console.log('[AIService] Spawning AI worker...');
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { type, id } = e.data;
      if (type === 'STATUS') {
        statusListeners.forEach(fn => fn(e.data.status));
        return;
      }
      if (type === 'EMBED_PROGRESS') {
        progressListeners.forEach(fn => fn(e.data.done, e.data.total));
        return;
      }
      if (id && pendingCallbacks.has(id)) {
        const { resolve, reject } = pendingCallbacks.get(id)!;
        pendingCallbacks.delete(id);
        if (type === 'ERROR') reject(new Error(e.data.error));
        else resolve(e.data);
      }
    };
  }
  return worker;
}

function call<T>(msg: object, transfer?: Transferable[]): Promise<T> {
  const id = Math.random().toString(36).slice(2);
  resetIdleTimer();
  return new Promise((resolve, reject) => {
    pendingCallbacks.set(id, { resolve, reject });
    const w = getWorker();
    if (transfer?.length) {
      w.postMessage({ ...msg, id }, transfer);
    } else {
      w.postMessage({ ...msg, id });
    }
  });
}

export const AIService = {
  onStatus(fn: (s: 'idle' | 'loading' | 'ready' | 'error') => void) {
    statusListeners.push(fn);
    return () => { statusListeners = statusListeners.filter(f => f !== fn); };
  },

  onProgress(fn: (done: number, total: number) => void) {
    progressListeners.push(fn);
    return () => { progressListeners = progressListeners.filter(f => f !== fn); };
  },

  async init(): Promise<void> {
    await call({ type: 'INIT' });
  },

  async embedQuery(text: string): Promise<Float32Array> {
    const res = await call<{ vec: Float32Array }>({ type: 'EMBED_QUERY', text });
    return res.vec;
  },

  async embedDocs(docs: { path: string; text: string }[]): Promise<{ path: string; vec: Float32Array }[]> {
    const res = await call<{ results: { path: string; vec: Float32Array }[] }>({ type: 'EMBED_DOCS', docs });
    return res.results;
  },

  async search(
    queryVec: Float32Array,
    index: { path: string; label: string; vec: Float32Array }[],
    topK = 5,
  ): Promise<{ path: string; label: string; score: number }[]> {
    const res = await call<{ results: { path: string; label: string; score: number }[] }>(
      { type: 'SEARCH', queryVec, index, topK },
      [queryVec.buffer],
    );
    return res.results;
  },

  terminate() {
    if (worker) {
      worker.terminate();
      worker = null;
      statusListeners.forEach(fn => fn('idle'));
      console.log('[AIService] AI worker terminated.');
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    // Reject any pending callbacks
    pendingCallbacks.forEach(({ reject }) => reject(new Error('Worker terminated')));
    pendingCallbacks.clear();
  },
};
