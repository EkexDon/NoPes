import { describe, it, expect } from 'vitest';
import {
  extractTasks, parseDue, taskDisplayText, extractTaskTags, extractWikilinks,
  extractNoteTags, extractFrontmatter, indexNote, toggleTaskLine, VaultIndex,
  INDEX_SCHEMA_VERSION,
} from '../vaultIndex';

describe('extractTasks', () => {
  it('extracts tasks with line numbers, checked state, due, tags', () => {
    const md = [
      '# Note',
      '- [ ] Call dentist @due(2026-07-15) #errand',
      '- [x] done thing',
      'plain text',
      '* [ ] star marker',
      '[ ] bare task',
    ].join('\n');
    const tasks = extractTasks('/v/n.md', md);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ line: 1, checked: false, due: '2026-07-15', tags: ['errand'] });
    expect(tasks[1]).toMatchObject({ line: 2, checked: true, due: null });
    expect(tasks[2].line).toBe(4);
    expect(tasks[3].line).toBe(5);
  });

  it('accepts lenient checkbox forms (empty brackets, escapes)', () => {
    const tasks = extractTasks('/v/n.md', '- [] loose\n\\[ \\] escaped');
    expect(tasks.map(t => t.text)).toEqual(['loose', 'escaped']);
  });

  it('ignores checkboxes inside fenced code', () => {
    const md = '```\n- [ ] not a task\n```\n- [ ] real task';
    const tasks = extractTasks('/v/n.md', md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('real task');
  });
});

describe('parseDue', () => {
  it('parses a valid due date', () => {
    expect(parseDue('x @due(2026-07-15) y')).toBe('2026-07-15');
  });
  it('rejects rolled-over dates', () => {
    expect(parseDue('@due(2026-13-45)')).toBeNull();
  });
  it('returns null when absent', () => {
    expect(parseDue('no due here')).toBeNull();
  });
});

describe('taskDisplayText', () => {
  it('strips @due but keeps tags', () => {
    expect(taskDisplayText('Call dentist @due(2026-07-15) #errand')).toBe('Call dentist #errand');
  });
});

describe('extractTaskTags / extractNoteTags', () => {
  it('collects lowercased unique tags', () => {
    expect(extractTaskTags('a #Work b #work #home-stuff')).toEqual(['work', 'home-stuff']);
  });
  it('note tags skip fenced code', () => {
    expect(extractNoteTags('#real\n```\n#fake\n```')).toEqual(['real']);
  });
  it('does not treat markdown headings as tags', () => {
    expect(extractTaskTags('# Heading')).toEqual([]);
  });
});

describe('extractWikilinks', () => {
  it('collects unique link targets, ignoring aliases', () => {
    expect(extractWikilinks('[[A]] [[B|shown]] [[A]]')).toEqual(['A', 'B']);
  });
});

describe('extractFrontmatter', () => {
  it('parses key: value pairs', () => {
    const fm = extractFrontmatter('---\nstatus: active\ntags: x\n---\nbody');
    expect(fm).toEqual({ status: 'active', tags: 'x' });
  });
  it('returns {} without frontmatter', () => {
    expect(extractFrontmatter('# just a note')).toEqual({});
  });
});

describe('toggleTaskLine', () => {
  const md = '# N\n- [ ] task one\n- [x] task two';

  it('checks an unchecked task', () => {
    const out = toggleTaskLine(md, 1, 'task one');
    expect(out).toContain('- [x] task one');
    expect(out).toContain('- [x] task two');
  });

  it('unchecks a checked task', () => {
    const out = toggleTaskLine(md, 2, 'task two');
    expect(out).toContain('- [ ] task two');
  });

  it('refuses to toggle when the line changed since indexing', () => {
    expect(toggleTaskLine(md, 1, 'different text')).toBeNull();
    expect(toggleTaskLine(md, 0, 'task one')).toBeNull();
    expect(toggleTaskLine(md, 99, 'task one')).toBeNull();
  });

  it('preserves indentation and marker style', () => {
    const nested = '  * [ ] indented star';
    const out = toggleTaskLine(nested, 0, 'indented star');
    expect(out).toBe('  * [x] indented star');
  });
});

describe('VaultIndex', () => {
  it('update/get/remove round-trip', () => {
    const idx = new VaultIndex();
    idx.updateNote('/v/a.md', '- [ ] t #x', 111);
    expect(idx.get('/v/a.md')?.tasks).toHaveLength(1);
    idx.removeNote('/v/a.md');
    expect(idx.get('/v/a.md')).toBeUndefined();
  });

  it('rename carries entry and rewrites task notePaths', () => {
    const idx = new VaultIndex();
    idx.updateNote('/v/a.md', '- [ ] t', 1);
    idx.renameNote('/v/a.md', '/v/b.md');
    expect(idx.get('/v/a.md')).toBeUndefined();
    expect(idx.get('/v/b.md')?.tasks[0].notePath).toBe('/v/b.md');
  });

  it('retainOnly drops deleted files', () => {
    const idx = new VaultIndex();
    idx.updateNote('/v/a.md', 'x', 1);
    idx.updateNote('/v/b.md', 'y', 1);
    idx.retainOnly(new Set(['/v/b.md']));
    expect(idx.size).toBe(1);
    expect(idx.has('/v/b.md')).toBe(true);
  });

  it('allTasks aggregates across notes', () => {
    const idx = new VaultIndex();
    idx.updateNote('/v/a.md', '- [ ] one', 1);
    idx.updateNote('/v/b.md', '- [ ] two\n- [x] three', 1);
    expect(idx.allTasks()).toHaveLength(3);
  });

  it('notesModifiedSince filters by mtime', () => {
    const idx = new VaultIndex();
    idx.updateNote('/v/old.md', 'x', 100);
    idx.updateNote('/v/new.md', 'y', 200);
    expect(idx.notesModifiedSince(150).map(n => n.path)).toEqual(['/v/new.md']);
  });

  it('serializes and revives via toJSON/fromJSON', () => {
    const idx = new VaultIndex();
    idx.updateNote('/v/a.md', '- [ ] t @due(2026-07-15)', 42);
    const revived = VaultIndex.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
    expect(revived.size).toBe(1);
    expect(revived.get('/v/a.md')?.tasks[0].due).toBe('2026-07-15');
  });

  it('rejects foreign/old schema payloads (caller rebuilds)', () => {
    expect(VaultIndex.fromJSON(null).size).toBe(0);
    expect(VaultIndex.fromJSON({ version: INDEX_SCHEMA_VERSION - 1, notes: [] }).size).toBe(0);
    expect(VaultIndex.fromJSON({ garbage: true }).size).toBe(0);
  });
});

describe('indexNote', () => {
  it('produces a complete entry', () => {
    const entry = indexNote('/v/n.md', '---\nstatus: wip\n---\n# T\n[[Other]]\n- [ ] do #x\nsome words here', 7);
    expect(entry.mtime).toBe(7);
    expect(entry.frontmatter.status).toBe('wip');
    expect(entry.wikilinks).toEqual(['Other']);
    expect(entry.tasks).toHaveLength(1);
    expect(entry.tags).toContain('x');
    expect(entry.wordCount).toBeGreaterThan(5);
  });
});
