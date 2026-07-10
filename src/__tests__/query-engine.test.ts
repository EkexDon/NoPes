import { describe, it, expect } from 'vitest';
import { parseQuery, runQuery, noteName } from '../queryEngine';
import { indexNote, NoteIndexEntry } from '../vaultIndex';

const NOTES: NoteIndexEntry[] = [
  indexNote('/v/Project Plan.md', '---\nstatus: active\n---\n#project\n- [ ] ship it\nwords here', 300),
  indexNote('/v/Archive.md', '---\nstatus: done\n---\n#project old text', 100),
  indexNote('/v/Recipes.md', '#cooking\n[[Project Plan]]\nlots of words '.repeat(10), 200),
  indexNote('/v/Flash.md', 'What is X ?? Y', 50),
];

describe('parseQuery', () => {
  it('splits filters, sort, and limit', () => {
    const q = parseQuery('tag=#project status=active sort=name limit=5');
    expect(q.filters).toEqual([
      { key: 'tag', value: '#project' },
      { key: 'status', value: 'active' },
    ]);
    expect(q.sort).toBe('name');
    expect(q.limit).toBe(5);
  });

  it('ignores malformed tokens and clamps limit', () => {
    const q = parseQuery('nonsense =bad limit=9999 sort=bogus');
    expect(q.filters).toEqual([]);
    expect(q.limit).toBe(500);
    expect(q.sort).toBe('modified');
  });
});

describe('runQuery', () => {
  it('filters by tag (with or without #)', () => {
    expect(runQuery(NOTES, 'tag=#project').map(noteName)).toEqual(['Project Plan', 'Archive']);
    expect(runQuery(NOTES, 'tag=cooking').map(noteName)).toEqual(['Recipes']);
  });

  it('filters by frontmatter key=value', () => {
    expect(runQuery(NOTES, 'status=active').map(noteName)).toEqual(['Project Plan']);
  });

  it('combines filters with AND', () => {
    expect(runQuery(NOTES, 'tag=project status=done').map(noteName)).toEqual(['Archive']);
  });

  it('has=tasks / has=cards / has=links', () => {
    expect(runQuery(NOTES, 'has=tasks').map(noteName)).toEqual(['Project Plan']);
    expect(runQuery(NOTES, 'has=cards').map(noteName)).toEqual(['Flash']);
    expect(runQuery(NOTES, 'has=links').map(noteName)).toEqual(['Recipes']);
  });

  it('name substring match, case-insensitive', () => {
    expect(runQuery(NOTES, 'name=plan').map(noteName)).toEqual(['Project Plan']);
  });

  it('sorts by modified desc by default, name asc, words desc', () => {
    expect(runQuery(NOTES, '').map(n => n.mtime)).toEqual([300, 200, 100, 50]);
    expect(runQuery(NOTES, 'sort=name').map(noteName)[0]).toBe('Archive');
    expect(runQuery(NOTES, 'sort=words').map(noteName)[0]).toBe('Recipes');
  });

  it('applies limit', () => {
    expect(runQuery(NOTES, 'limit=2')).toHaveLength(2);
  });

  it('empty query returns everything (up to default limit)', () => {
    expect(runQuery(NOTES, '')).toHaveLength(4);
  });
});
