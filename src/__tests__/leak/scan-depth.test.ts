import { describe, it, expect, vi } from 'vitest';
import { scanDir } from '@/store/useStore';
import * as fsPlugin from '@tauri-apps/plugin-fs';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...args) => Promise.resolve(args.join('/'))),
  basename: vi.fn(a => Promise.resolve(a.split('/').pop())),
  dirname: vi.fn(a => Promise.resolve(a.split('/').slice(0, -1).join('/'))),
}));

describe('scan-depth', () => {
  it('should terminate scan in deep self-referencing hierarchy', async () => {
    // Mock readDir to always return a fake directory called "loop"
    vi.mocked(fsPlugin.readDir).mockResolvedValue([
      { name: 'loop', isDirectory: true, isFile: false, isSymlink: false }
    ]);
    const start = Date.now();
    const result = await scanDir('/mock', { maxDepth: 12, maxEntries: 20000, visited: new Set() }, []);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(150); // <100ms usually, give some buffer
    expect(result.truncated).toBe(true);

    // Assert depth is <= 12
    let depth = 0;
    let curr = result.entries[0];
    while (curr) {
      depth++;
      curr = curr.children?.[0] as any;
    }
    expect(depth).toBeLessThanOrEqual(12);
  });
});
