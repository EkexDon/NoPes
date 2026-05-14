import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '@/store/useStore';

// Mock AIService
vi.mock('@/workers/AIService', () => ({
  AIService: {
    embedDocs: vi.fn(),
  },
}));

// Mock Tauri APIs
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...args) => Promise.resolve(args.join('/'))),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn().mockResolvedValue('this is a long enough text to be embedded'),
  readDir: vi.fn().mockResolvedValue([]),
  exists: vi.fn().mockResolvedValue(false),
}));

describe('ai-index', () => {
  beforeEach(() => {
    useStore.getState().clearAiIndex();
  });

  it('should prune oldest 20% when exceeding 10000 entries', async () => {
    const store = useStore.getState();
    
    // Manually populate to near limit
    const initialItems = Array.from({ length: 9999 }, (_, i) => ({
      path: `path-${i}`,
      label: `label-${i}`,
      vec: new Float32Array([i])
    }));
    
    useStore.setState({ aiIndex: initialItems });
    
    // Mock embedDocs to return 2 new items (total would be 10001)
    const { AIService } = await import('@/workers/AIService');
    vi.mocked(AIService.embedDocs).mockResolvedValue([
      { path: 'new-1', vec: new Float32Array([1]) },
      { path: 'new-2', vec: new Float32Array([2]) }
    ]);
    
    // Ensure allFiles has .md extension and they exist in tabContents (or mocked readTextFile)
    useStore.setState({ 
      allFiles: [
        { name: 'new-1.md', path: 'new-1', is_dir: false }, 
        { name: 'new-2.md', path: 'new-2', is_dir: false }
      ], 
      vaultPath: '/mock-vault', 
      isAiEnabled: true,
      tabContents: {
        'new-1': 'content with more than ten chars',
        'new-2': 'another content with more than ten chars'
      }
    });
    
    await useStore.getState().buildAiIndex();
    
    const finalIndex = useStore.getState().aiIndex;
    // 9999 + 2 = 10001. Pruning 20% (2000 items) leaves 8001.
    expect(finalIndex.length).toBe(8001);
    expect(finalIndex[0].path).toBe('path-2000');
    expect(finalIndex[finalIndex.length - 1].path).toBe('new-2');
  });

  it('should clear index on vault switch', async () => {
    useStore.setState({ aiIndex: [{ path: 'old', label: 'old', vec: new Float32Array([1]) }] });
    expect(useStore.getState().aiIndex.length).toBe(1);
    
    await useStore.getState().setVaultPath('/new-vault');
    expect(useStore.getState().aiIndex.length).toBe(0);
  });
});
