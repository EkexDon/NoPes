import { describe, it, expect } from 'vitest';
import { parseKanban, fullRebuildMarkdown } from '../components/KanbanView';

const BOARD = `<!-- KANBAN -->

# My Board

Intro paragraph that must survive.

## 📋 To Do
Some column notes.
- [ ] Task A
- [ ] Task B

More prose under the column.

## 🔄 In Progress

## ✅ Done
- [x] Task C
`;

describe('parseKanban', () => {
  it('parses columns and cards', () => {
    const cols = parseKanban(BOARD);
    expect(cols.map(c => c.title)).toEqual(['📋 To Do', '🔄 In Progress', '✅ Done']);
    expect(cols[0].cards.map(c => c.text)).toEqual(['Task A', 'Task B']);
    expect(cols[2].cards[0].checked).toBe(true);
  });

  it('accepts emoji-only headings (TipTap strips ##)', () => {
    const cols = parseKanban('📋 To Do\n- [ ] X\n\n✅ Done\n- [x] Y');
    expect(cols.map(c => c.title)).toEqual(['📋 To Do', '✅ Done']);
  });

  it('accepts lenient checkbox forms users actually type', () => {
    const md = [
      '## Col',
      '- [] no inner space',            // typed "[]"
      '- [ ]no space after bracket',
      '[x] bare checked',
      '\\[ \\] tiptap-escaped brackets', // markdown serializer escapes plain text
      '+ [ ] plus marker',
    ].join('\n');
    const cols = parseKanban(md);
    expect(cols[0].cards.map(c => c.text)).toEqual([
      'no inner space',
      'no space after bracket',
      'bare checked',
      'tiptap-escaped brackets',
      'plus marker',
    ]);
    expect(cols[0].cards[2].checked).toBe(true);
    expect(cols[0].cards[0].checked).toBe(false);
  });

  it('does not treat links or reference text as cards', () => {
    const md = '## Col\nSee [the docs](https://x.dev) for more.\n[note]: something\n- [ ] real card';
    const cols = parseKanban(md);
    expect(cols[0].cards.map(c => c.text)).toEqual(['real card']);
  });

  it('gives unique ids to duplicate column titles and all cards', () => {
    const cols = parseKanban('## Same\n- [ ] a\n\n## Same\n- [ ] b');
    expect(cols[0].id).not.toBe(cols[1].id);
    const cardIds = cols.flatMap(c => c.cards.map(x => x.id));
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });
});

describe('fullRebuildMarkdown', () => {
  it('round-trips without changing cards', () => {
    const cols = parseKanban(BOARD);
    const out = fullRebuildMarkdown(BOARD, cols);
    expect(parseKanban(out)).toEqual(parseKanban(BOARD));
  });

  it('preserves prose, intro and per-column notes', () => {
    const cols = parseKanban(BOARD);
    // simulate a toggle
    cols[0].cards[0].checked = true;
    const out = fullRebuildMarkdown(BOARD, cols);
    expect(out).toContain('Intro paragraph that must survive.');
    expect(out).toContain('Some column notes.');
    expect(out).toContain('More prose under the column.');
    expect(out).toContain('- [x] Task A');
    expect(out).toContain('- [ ] Task B');
  });

  it('moves a card between columns without touching other text', () => {
    const cols = parseKanban(BOARD);
    const [card] = cols[0].cards.splice(0, 1);
    cols[1].cards.push(card);
    const out = fullRebuildMarkdown(BOARD, cols);
    const reparsed = parseKanban(out);
    expect(reparsed[0].cards.map(c => c.text)).toEqual(['Task B']);
    expect(reparsed[1].cards.map(c => c.text)).toEqual(['Task A']);
    expect(out).toContain('Intro paragraph that must survive.');
    expect(out).toContain('More prose under the column.');
  });

  it('inserts into a column that had no cards (after its heading)', () => {
    const cols = parseKanban(BOARD);
    cols[1].cards.push({ id: 'card-new', text: 'Fresh task', checked: false });
    const out = fullRebuildMarkdown(BOARD, cols);
    const progressIdx = out.indexOf('## 🔄 In Progress');
    const doneIdx = out.indexOf('## ✅ Done');
    const taskIdx = out.indexOf('- [ ] Fresh task');
    expect(taskIdx).toBeGreaterThan(progressIdx);
    expect(taskIdx).toBeLessThan(doneIdx);
  });

  it('handles checkboxes before any heading via the default column', () => {
    const md = 'Notes first.\n- [ ] loose task\n\n## Col\n- [ ] real task';
    const cols = parseKanban(md);
    expect(cols[0].id).toBe('col-default');
    cols[0].cards[0].checked = true;
    const out = fullRebuildMarkdown(md, cols);
    expect(out).toContain('Notes first.');
    expect(out).toContain('- [x] loose task');
    expect(out).toContain('- [ ] real task');
  });
});
