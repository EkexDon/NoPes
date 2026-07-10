import { describe, it, expect } from 'vitest';
import { findUnlinkedMentions, linkMentions, maskNonMentionRegions } from '../mentions';

describe('findUnlinkedMentions', () => {
  it('finds a plain-text mention with context snippet', () => {
    const hits = findUnlinkedMentions('I talked about Project X again today.', 'Project X');
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('Project X');
    expect(hits[0].snippet).toContain('talked about Project X again');
  });

  it('is case-insensitive but preserves original casing', () => {
    const hits = findUnlinkedMentions('the project x meeting', 'Project X');
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('project x');
  });

  it('ignores mentions already inside wikilinks', () => {
    expect(findUnlinkedMentions('See [[Project X]] for details.', 'Project X')).toHaveLength(0);
    expect(findUnlinkedMentions('See [[Project X|the project]].', 'Project X')).toHaveLength(0);
  });

  it('ignores mentions inside code', () => {
    expect(findUnlinkedMentions('run `Project X` now', 'Project X')).toHaveLength(0);
    expect(findUnlinkedMentions('```\nProject X\n```', 'Project X')).toHaveLength(0);
  });

  it('requires word boundaries', () => {
    expect(findUnlinkedMentions('Notes on Reactive systems', 'React')).toHaveLength(0);
    expect(findUnlinkedMentions('I love React!', 'React')).toHaveLength(1);
  });

  it('handles names with regex special characters', () => {
    const hits = findUnlinkedMentions('read C++ (Advanced) yesterday', 'C++ (Advanced)');
    expect(hits).toHaveLength(1);
  });

  it('skips 1-character names', () => {
    expect(findUnlinkedMentions('a a a', 'a')).toHaveLength(0);
  });

  it('finds multiple mentions with correct indices', () => {
    const content = 'Alpha here. Later: Alpha again.';
    const hits = findUnlinkedMentions(content, 'Alpha');
    expect(hits).toHaveLength(2);
    expect(content.slice(hits[1].index, hits[1].index + 5)).toBe('Alpha');
  });
});

describe('linkMentions', () => {
  it('wraps an exact-case mention in a plain wikilink', () => {
    const r = linkMentions('about Project X today', 'Project X');
    expect(r.content).toBe('about [[Project X]] today');
    expect(r.linked).toBe(1);
  });

  it('uses alias form when the casing differs, preserving visible text', () => {
    const r = linkMentions('the project x meeting', 'Project X');
    expect(r.content).toBe('the [[Project X|project x]] meeting');
  });

  it('links multiple mentions and leaves existing links untouched', () => {
    const r = linkMentions('Alpha, [[Alpha]], and Alpha.', 'Alpha');
    expect(r.content).toBe('[[Alpha]], [[Alpha]], and [[Alpha]].');
    expect(r.linked).toBe(2);
  });

  it('is a no-op when there is nothing to link', () => {
    const input = 'Nothing relevant here.';
    expect(linkMentions(input, 'Project X')).toEqual({ content: input, linked: 0 });
  });
});

describe('maskNonMentionRegions', () => {
  it('preserves string length exactly (index alignment)', () => {
    const s = 'a [[link]] and `code` and\n```\nfence\n```\nrest';
    expect(maskNonMentionRegions(s).length).toBe(s.length);
  });

  it('masks an unterminated code fence to the end', () => {
    const s = 'before\n```\nsecret Project X';
    expect(maskNonMentionRegions(s)).not.toContain('Project X');
  });
});
