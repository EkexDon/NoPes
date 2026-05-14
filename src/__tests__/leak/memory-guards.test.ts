import { describe, expect, it } from 'vitest';
import { applyGraphOverride, mergeAiIndex, sanitizeAiIndex, type GraphData } from '@/store/useStore';

describe('memory-guards', () => {
  it('sanitizeAiIndex should dedupe, drop invalid vectors, and cap entries', () => {
    const raw = [
      { path: '/a.md', label: 'A-old', vec: [1, 2, 3] },
      { path: '/b.md', label: 'B', vec: [3, 4, 5] },
      { path: '/a.md', label: 'A-new', vec: [9, 9, 9] }, // duplicate path, keep newest
      { path: '/bad.md', label: 'Bad', vec: ['x'] },     // invalid vec
    ];

    const out = sanitizeAiIndex(raw, 2);
    expect(out).toHaveLength(2);
    expect(out[0].path).toBe('/b.md');
    expect(out[1].path).toBe('/a.md');
    expect(Array.from(out[1].vec)).toEqual([9, 9, 9]);
  });

  it('mergeAiIndex should prune when exceeding cap', () => {
    const mk = (path: string, n: number) => ({ path, label: path, vec: new Float32Array([n]) });
    const existing = [mk('/1.md', 1), mk('/2.md', 2), mk('/3.md', 3), mk('/4.md', 4)];
    const incoming = [mk('/5.md', 5)];

    const merged = mergeAiIndex(existing, incoming, 4, 0.25);
    expect(merged.pruned).toBe(true);
    expect(merged.index.map(x => x.path)).toEqual(['/2.md', '/3.md', '/4.md', '/5.md']);
  });

  it('applyGraphOverride should replace only source links and source tags', () => {
    const graph: GraphData = {
      nodes: [
        { id: '/a.md', label: 'a', tags: ['old'] },
        { id: '/b.md', label: 'b', tags: [] },
        { id: '/c.md', label: 'c', tags: [] },
      ],
      links: [
        { source: '/a.md', target: '/b.md' },
        { source: '/c.md', target: '/a.md' },
      ],
    };

    const allFiles = [
      { name: 'a.md', path: '/a.md', is_dir: false },
      { name: 'b.md', path: '/b.md', is_dir: false },
      { name: 'c.md', path: '/c.md', is_dir: false },
    ];

    const out = applyGraphOverride(graph, allFiles, {
      path: '/a.md',
      text: '[[c]] #fresh',
    });

    expect(out.links).toContainEqual({ source: '/a.md', target: '/c.md' });
    expect(out.links).toContainEqual({ source: '/c.md', target: '/a.md' }); // untouched inbound
    expect(out.links).not.toContainEqual({ source: '/a.md', target: '/b.md' }); // replaced outbound
    const aNode = out.nodes.find(n => n.id === '/a.md');
    expect(aNode?.tags).toEqual(['fresh']);
  });
});
