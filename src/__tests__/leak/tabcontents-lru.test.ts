import { describe, it, expect } from 'vitest';
import { enforceTabContentsLRU } from '@/store/useStore';

describe('tabcontents-lru', () => {
  it('should cap at 64 entries', () => {
    let contents: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      contents[`key-${i}`] = 'some content';
    }
    
    // activePaths empty
    const result = enforceTabContentsLRU(contents, [], 64, 32 * 1024 * 1024);
    
    const keys = Object.keys(result);
    expect(keys.length).toBe(64);
    // Keys 0-35 should be evicted
    expect(result['key-0']).toBeUndefined();
    expect(result['key-35']).toBeUndefined();
    expect(result['key-36']).toBeDefined();
    expect(result['key-99']).toBeDefined();
  });

  it('should cap at 32 MB and evict non-active tabs', () => {
    let contents: Record<string, string> = {
      'small-1': 'abc',
      'small-2': 'def',
      'giant': 'a'.repeat(33 * 1024 * 1024) // 33 MB
    };
    
    // If we insert giant, it should evict small ones if they aren't active
    const result = enforceTabContentsLRU(contents, [], 64, 32 * 1024 * 1024);
    
    expect(Object.keys(result)).toEqual(['giant']);
  });

  it('should NOT evict active tabs even if over cap', () => {
    let contents: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      contents[`key-${i}`] = 'content';
    }
    
    // Set cap to 5, but keys 0-4 are active
    const active = ['key-0', 'key-1', 'key-2', 'key-3', 'key-4'];
    const result = enforceTabContentsLRU(contents, active, 5, 1024);
    
    // It should have evicted 5-9, but kept 0-4
    const keys = Object.keys(result);
    expect(keys).toContain('key-0');
    expect(keys).toContain('key-4');
    expect(keys.length).toBe(5);
    expect(result['key-5']).toBeUndefined();
  });
});
