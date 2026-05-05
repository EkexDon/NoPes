import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();

  postMessage = vi.fn((message: any) => {
    const respond = (payload: any) => {
      this.onmessage?.({ data: payload } as MessageEvent);
    };

    if (message.type === 'SET_INDEX') {
      queueMicrotask(() => respond({ type: 'SET_INDEX_OK', id: message.id }));
      return;
    }

    if (message.type === 'SEARCH') {
      queueMicrotask(() => respond({ type: 'SEARCH_OK', id: message.id, results: [] }));
      return;
    }

    if (message.type === 'INIT') {
      queueMicrotask(() => respond({ type: 'INIT_OK', id: message.id }));
    }
  });
}

describe('ai-service-search-cache', () => {
  let originalWorker: typeof Worker | undefined;
  const workers: MockWorker[] = [];

  beforeEach(() => {
    vi.resetModules();
    workers.length = 0;
    originalWorker = globalThis.Worker;
    (globalThis as any).Worker = vi.fn(() => {
      const w = new MockWorker();
      workers.push(w);
      return w;
    });
  });

  afterEach(async () => {
    const { AIService } = await import('@/workers/AIService');
    AIService.terminate();
    if (originalWorker) (globalThis as any).Worker = originalWorker;
    else delete (globalThis as any).Worker;
  });

  it('should sync index once and omit index payload on repeated searches', async () => {
    const { AIService } = await import('@/workers/AIService');
    const index = [{ path: '/a.md', label: 'a', vec: new Float32Array([1, 0, 0]) }];

    await AIService.search(new Float32Array([1, 0, 0]), index, 3);
    await AIService.search(new Float32Array([0, 1, 0]), index, 3);

    expect(workers).toHaveLength(1);
    const posted = workers[0].postMessage.mock.calls.map(call => call[0]);
    const setIndexCalls = posted.filter(msg => msg.type === 'SET_INDEX');
    const searchCalls = posted.filter(msg => msg.type === 'SEARCH');

    expect(setIndexCalls).toHaveLength(1);
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls.every(msg => !('index' in msg))).toBe(true);
  });

  it('should coalesce concurrent init calls into one worker message', async () => {
    const { AIService } = await import('@/workers/AIService');
    await Promise.all([AIService.init(), AIService.init(), AIService.init()]);

    expect(workers).toHaveLength(1);
    const initCalls = workers[0].postMessage.mock.calls
      .map(call => call[0])
      .filter(msg => msg.type === 'INIT');
    expect(initCalls).toHaveLength(1);
  });
});
