import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { CheckSquare, Square, Plus, Kanban } from 'lucide-react';

interface KanbanCard {
  id: string;
  text: string;
  checked: boolean;
}

interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

// Matches: "- [ ] text", "* [ ] text", "[ ] text", and checked variants.
// Lenient on purpose: empty brackets "[]", missing space after "]", and
// TipTap-escaped brackets "\[ \]" (the markdown serializer escapes plain-
// text brackets) must all still count as cards.
const checkboxRe = /^(?:[-*+]\s+)?\\?\[( |x)?\\?\]\s*(.+)$/i;
// Heading: ## Title OR a line starting with emoji followed by space and
// text (e.g. "📋 To Do") — TipTap strips the ## from emoji headings.
const emojiHeadingRe = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}](?:‍[\p{Emoji_Presentation}\p{Extended_Pictographic}])*️?)\s+(.+)$/u;
const mdHeadingRe = /^#{2,6}\s+(.+)$/;

/* Column-heading detection shared by parse and rebuild — must stay in
   sync or rebuild writes cards into the wrong section. */
function headingTitleOf(trimmed: string): string | null {
  if (!trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('# ')) return null;
  const md = trimmed.match(mdHeadingRe);
  if (md) return md[1].trim();
  if (!checkboxRe.test(trimmed)) {
    const em = trimmed.match(emojiHeadingRe);
    if (em) return `${em[1]} ${em[2].trim()}`;
  }
  return null;
}

export function parseKanban(markdown: string): KanbanColumn[] {
  const lines = markdown.split('\n');
  const columns: KanbanColumn[] = [];
  let currentCol: KanbanColumn | null = null;
  let cardSeq = 0; // globally unique card ids — duplicate ids break toggle/drag

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('<!--') || trimmed.startsWith('# ')) continue;

    const headingTitle = headingTitleOf(trimmed);
    if (headingTitle !== null) {
      currentCol = {
        // index-prefixed so duplicate column titles still get unique ids
        id: `col-${columns.length}-${headingTitle}`,
        title: headingTitle,
        cards: [],
      };
      columns.push(currentCol);
      continue;
    }

    const cbMatch = trimmed.match(checkboxRe);
    if (cbMatch) {
      // If no column yet, auto-create a default one
      if (!currentCol) {
        currentCol = { id: 'col-default', title: '📋 Tasks', cards: [] };
        columns.unshift(currentCol); // put at front
      }
      currentCol.cards.push({
        id: `card-${cardSeq++}`,
        text: cbMatch[2].trim(),
        checked: (cbMatch[1] ?? '').toLowerCase() === 'x',
      });
    }
  }

  return columns;
}

/* Line-preserving rebuild: every non-checkbox line (prose, bullets,
   tables, code) stays exactly where it was. Only the checkbox lines of
   each column section are replaced — at the position of that section's
   first checkbox line, or right after the heading if it had none. */
export function fullRebuildMarkdown(original: string, columns: KanbanColumn[]): string {
  const lines = original.split('\n');

  // Split into sections: preamble (before first heading) + one per heading
  type Section = { title: string | null; start: number; end: number };
  const sections: Section[] = [];
  let cur: Section = { title: null, start: 0, end: lines.length };
  for (let i = 0; i < lines.length; i++) {
    const t = headingTitleOf(lines[i].trim());
    if (t !== null) {
      cur.end = i;
      sections.push(cur);
      cur = { title: t, start: i, end: lines.length };
    }
  }
  sections.push(cur);

  // Map columns to sections by order: 'col-default' ↔ preamble,
  // the rest ↔ heading sections in document order.
  const headingSections = sections.filter(s => s.title !== null);
  const defaultCol = columns.find(c => c.id === 'col-default') ?? null;
  const headingCols = columns.filter(c => c.id !== 'col-default');

  const renderSection = (section: Section, col: KanbanColumn | null): string[] => {
    const body = lines.slice(section.start, section.end);
    if (!col) return body;
    const cardLines = col.cards.map(c => `- [${c.checked ? 'x' : ' '}] ${c.text}`);
    const out: string[] = [];
    let inserted = false;
    for (let i = 0; i < body.length; i++) {
      if (checkboxRe.test(body[i].trim())) {
        if (!inserted) { out.push(...cardLines); inserted = true; }
        continue; // drop old checkbox line
      }
      out.push(body[i]);
    }
    if (!inserted && cardLines.length > 0) {
      // No checkbox lines existed — insert after the heading (heading
      // sections) or at the end (preamble).
      const at = section.title !== null ? 1 : out.length;
      out.splice(at, 0, '', ...cardLines);
    }
    return out;
  };

  const result: string[] = [];
  result.push(...renderSection(sections[0], defaultCol));
  headingSections.forEach((section, i) => {
    result.push(...renderSection(section, headingCols[i] ?? null));
  });
  // Columns with no matching section (shouldn't happen, but never drop data)
  for (let i = headingSections.length; i < headingCols.length; i++) {
    const col = headingCols[i];
    result.push('', `## ${col.title}`, ...col.cards.map(c => `- [${c.checked ? 'x' : ' '}] ${c.text}`));
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

export const KanbanView: React.FC = () => {
  const { activeTab, tabContents, saveFile } = useStore();
  const content = activeTab ? (tabContents[activeTab] ?? '') : '';

  const [localColumns, setLocalColumns] = useState<KanbanColumn[]>(() => parseKanban(content));

  // Track the last tab so we re-parse when it changes, but NOT on every keystroke in editor
  const prevTabRef = useRef<string | null>(activeTab ?? null);
  const lastSavedMdRef = useRef<string>(content);

  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      // Different file — always re-parse fresh
      prevTabRef.current = activeTab ?? null;
      lastSavedMdRef.current = content;
      setLocalColumns(parseKanban(content));
    } else if (content !== lastSavedMdRef.current) {
      // Same file but the content changed under us (editor pane, split
      // view, external save) — re-sync the board. Our own persists set
      // lastSavedMdRef first, so they don't loop through here.
      lastSavedMdRef.current = content;
      setLocalColumns(parseKanban(content));
    }
  }, [activeTab, content]);

  const [dragging, setDragging] = useState<{ colId: string; cardId: string } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [activeInsertCol, setActiveInsertCol] = useState<string | null>(null);
  const [newCardText, setNewCardText] = useState('');

  const persist = useCallback(
    (cols: KanbanColumn[]) => {
      if (!activeTab) return;
      const newMd = fullRebuildMarkdown(content, cols);
      lastSavedMdRef.current = newMd; // mark as our own write so sync doesn't re-parse
      // Update memory immediately (functional set — a spread of a stale
      // snapshot here used to clobber concurrent edits to other tabs),
      // then persist to disk.
      useStore.setState(state => ({ tabContents: { ...state.tabContents, [activeTab]: newMd } }));
      saveFile(activeTab, newMd);
    },
    [activeTab, content, saveFile]
  );

  const handleDrop = (targetColId: string) => {
    if (!dragging || dragging.colId === targetColId) {
      setDragging(null);
      setDragOverCol(null);
      return;
    }

    const newCols = localColumns.map((col) => ({ ...col, cards: [...col.cards] }));
    const srcCol = newCols.find((c) => c.id === dragging.colId);
    const dstCol = newCols.find((c) => c.id === targetColId);
    if (!srcCol || !dstCol) { setDragging(null); setDragOverCol(null); return; }

    const cardIdx = srcCol.cards.findIndex((c) => c.id === dragging.cardId);
    if (cardIdx === -1) { setDragging(null); setDragOverCol(null); return; }

    const [card] = srcCol.cards.splice(cardIdx, 1);
    dstCol.cards.push(card);

    setLocalColumns(newCols);
    persist(newCols);
    setDragging(null);
    setDragOverCol(null);
  };

  const toggleCard = (colId: string, cardId: string) => {
    const newCols = localColumns.map((col) => {
      if (col.id !== colId) return col;
      return {
        ...col,
        cards: col.cards.map((c) =>
          c.id === cardId ? { ...c, checked: !c.checked } : c
        ),
      };
    });
    setLocalColumns(newCols);
    persist(newCols);
  };

  const submitNewCard = (colId: string) => {
    if (!newCardText.trim()) {
      setActiveInsertCol(null);
      return;
    }
    const newCols = localColumns.map((col) => {
      if (col.id !== colId) return col;
      return {
        ...col,
        cards: [
          ...col.cards,
          {
            id: `card-${colId}-${Date.now()}`,
            text: newCardText.trim(),
            checked: false,
          },
        ],
      };
    });
    setLocalColumns(newCols);
    persist(newCols);
    setNewCardText('');
    setActiveInsertCol(null);
  };

  if (!activeTab) {
    return (
      <div className="kanban-empty">
        <Kanban size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
        <div className="empty-state-title">No note open</div>
        <div className="empty-state-hint">Open a note to view its Kanban board</div>
      </div>
    );
  }

  if (localColumns.length === 0) {
    return (
      <div className="kanban-empty">
        <Kanban size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
        <div className="empty-state-title">No Kanban columns found</div>
        <div className="empty-state-hint">
          Add <code>##</code> headings and <code>- [ ]</code> tasks to this note
        </div>
        <pre className="kanban-example">{`## 📋 Backlog\n- [ ] My first task\n\n## 🔄 In Progress\n- [ ] Working on it\n\n## ✅ Done\n- [x] Completed task`}</pre>
      </div>
    );
  }

  return (
    <div className="kanban-shell">
      <div className="kanban-topbar">
        <Kanban size={14} />
        <span>Kanban — {activeTab?.split('/').pop()?.replace('.md', '')}</span>
        <span className="kanban-hint">Drag cards between columns · Click ☑ to toggle</span>
      </div>
      <div className="kanban-board">
        {localColumns.map((col) => (
          <div
            key={col.id}
            className={`kanban-column ${dragOverCol === col.id ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={() => handleDrop(col.id)}
          >
            <div className="kanban-col-header">
              <span className="kanban-col-title">{col.title}</span>
              <span className="kanban-col-count">{col.cards.length}</span>
            </div>
            <div className="kanban-cards">
              {col.cards.map((card) => (
                <div
                  key={card.id}
                  className={`kanban-card ${card.checked ? 'done' : ''} ${dragging?.cardId === card.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragging({ colId: col.id, cardId: card.id })}
                  onDragEnd={() => { setDragging(null); setDragOverCol(null); }}
                >
                  <button
                    className="kanban-check"
                    onClick={() => toggleCard(col.id, card.id)}
                    title={card.checked ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {card.checked
                      ? <CheckSquare size={15} style={{ color: 'var(--accent)' }} />
                      : <Square size={15} style={{ color: 'var(--tx-3)' }} />
                    }
                  </button>
                  <span className="kanban-card-text">{card.text}</span>
                </div>
              ))}
              
              {activeInsertCol === col.id ? (
                <div className="kanban-card-input-wrapper">
                  <input
                    autoFocus
                    className="kanban-card-input"
                    placeholder="Enter task..."
                    value={newCardText}
                    onChange={(e) => setNewCardText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNewCard(col.id);
                      if (e.key === 'Escape') {
                        setActiveInsertCol(null);
                        setNewCardText('');
                      }
                    }}
                    onBlur={() => {
                      if (!newCardText.trim()) setActiveInsertCol(null);
                    }}
                  />
                  <div className="kanban-input-actions">
                    <button className="kanban-btn-add" onClick={() => submitNewCard(col.id)}>Add</button>
                    <button className="kanban-btn-cancel" onClick={() => { setActiveInsertCol(null); setNewCardText(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="kanban-add-card" onClick={() => { setActiveInsertCol(col.id); setNewCardText(''); }}>
                  <Plus size={12} /> Add card
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
