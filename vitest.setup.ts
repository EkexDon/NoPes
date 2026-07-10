import { vi } from 'vitest';

// Functional localStorage: real Map-backed behavior (get/set round-trips
// work) wrapped in vi.fn so tests can still assert on calls.
const backing = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => (backing.has(k) ? backing.get(k)! : null)),
  setItem: vi.fn((k: string, v: string) => { backing.set(k, String(v)); }),
  removeItem: vi.fn((k: string) => { backing.delete(k); }),
  clear: vi.fn(() => { backing.clear(); }),
  key: vi.fn((i: number) => [...backing.keys()][i] ?? null),
  get length() { return backing.size; },
};

global.localStorage = localStorageMock as any;

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver as any;
