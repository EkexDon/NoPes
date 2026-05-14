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

function parseKanban(markdown: string): KanbanColumn[] {
  const lines = markdown.split('\n');
  const columns: KanbanColumn[] = [];
  let currentCol: KanbanColumn | null = null;

  // Matches: "- [ ] text", "* [ ] text", "[ ] text", and checked variants
  const checkboxRe = /^(?:[-*]\s+)?\[( |x)\]\s+(.+)$/i;

  // Heading: ## Title OR a line starting with emoji followed by space and text (e.g. "📋 To Do")
  // Emoji range covers most common emojis
  const emojiHeadingRe = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u200d[\p{Emoji_Presentation}\p{Extended_Pictographic}])*\uFE0F?)\s+(.+)$/u;
  const mdHeadingRe = /^#{1,6}\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip H1 title and HTML comments
    if (trimmed.startsWith('<!--') || trimmed.startsWith('# ')) continue;

    // Try markdown heading first (## Title)
    let headingTitle: string | null = null;
    const mdMatch = trimmed.match(mdHeadingRe);
    if (mdMatch) {
      headingTitle = mdMatch[1].trim();
    } else {
      // Try emoji heading (📋 To Do, ✅ Done, etc.) — only if NOT a checkbox
      const cbCheck = trimmed.match(checkboxRe);
      if (!cbCheck) {
        const emojiMatch = trimmed.match(emojiHeadingRe);
        if (emojiMatch) {
          headingTitle = `${emojiMatch[1]} ${emojiMatch[2].trim()}`;
        }
      }
    }

    if (headingTitle) {
      currentCol = {
        id: `col-${headingTitle}`,
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
        id: `card-${currentCol.id}-${currentCol.cards.length}`,
        text: cbMatch[2].trim(),
        checked: cbMatch[1].toLowerCase() === 'x',
      });
    }
  }

  return columns;
}

function fullRebuildMarkdown(original: string, columns: KanbanColumn[]): string {
  // Strategy: Keep header (everything before first column heading) + rebuild kanban section
  const lines = original.split('\n');
  const checkboxRe = /^(?:[-*]\s+)?\[( |x)\]\s+(.+)$/i;
  const emojiHeadingRe = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u200d[\p{Emoji_Presentation}\p{Extended_Pictographic}])*\uFE0F?)\s+(.+)$/u;
  const mdHeadingRe = /^#{2,6}\s+(.+)$/;

  // Find the line index where the first column heading starts
  let firstHeadingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('<!--') || trimmed.startsWith('# ')) continue;

    if (mdHeadingRe.test(trimmed)) {
      firstHeadingIdx = i;
      break;
    }
    // Emoji heading - but only if NOT a checkbox
    if (!checkboxRe.test(trimmed) && emojiHeadingRe.test(trimmed)) {
      firstHeadingIdx = i;
      break;
    }
  }

  // Header part: everything before first column
  const header = firstHeadingIdx >= 0
    ? lines.slice(0, firstHeadingIdx).join('\n').replace(/\n+$/, '')
    : lines.join('\n').replace(/\n+$/, '');

  // Build kanban section from columns
  const kanbanLines: string[] = [];
  for (const col of columns) {
    kanbanLines.push('');
    kanbanLines.push(`## ${col.title}`);
    for (const card of col.cards) {
      kanbanLines.push(`- [${card.checked ? 'x' : ' '}] ${card.text}`);
    }
  }

  return (header + '\n' + kanbanLines.join('\n') + '\n').replace(/\n{3,}/g, '\n\n');
}

export const KanbanView: React.FC = () => {
  const { activeTab, tabContents, saveFile } = useStore();
  const content = activeTab ? (tabContents[activeTab] ?? '') : '';

  const [localColumns, setLocalColumns] = useState<KanbanColumn[]>(() => parseKanban(content));

  // Track the last tab so we re-parse when it changes, but NOT on every keystroke in editor
  const prevTabRef = useRef<string | null>(activeTab ?? null);
  const lastSavedMdRef = useRef<string>(content);

  useEffect(() => {
    console.log('[KanbanView] Effect triggered:', { activeTab, contentLength: content.length, prevTab: prevTabRef.current });
    if (prevTabRef.current !== activeTab) {
      // Different file — always re-parse fresh
      console.log('[KanbanView] Tab changed, re-parsing');
      prevTabRef.current = activeTab ?? null;
      lastSavedMdRef.current = content;
      const parsed = parseKanban(content);
      console.log('[KanbanView] Parsed columns:', parsed.length, 'Total cards:', parsed.reduce((acc, c) => acc + c.cards.length, 0));
      setLocalColumns(parsed);
      return;
    }
    // Same tab — only re-parse if content was changed EXTERNALLY (i.e. by the Editor, not by us)
    if (content !== lastSavedMdRef.current) {
      console.log('[KanbanView] Content changed externally, re-parsing');
      lastSavedMdRef.current = content;
      const parsed = parseKanban(content);
      console.log('[KanbanView] Parsed columns:', parsed.length, 'Total cards:', parsed.reduce((acc, c) => acc + c.cards.length, 0));
      setLocalColumns(parsed);
    }
  }, [activeTab, content]);

  const [dragging, setDragging] = useState<{ colId: string; cardId: string } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [activeInsertCol, setActiveInsertCol] = useState<string | null>(null);
  const [newCardText, setNewCardText] = useState('');

  const { setTabContents } = useStore.getState();

  const persist = useCallback(
    (cols: KanbanColumn[]) => {
      if (!activeTab) return;
      const newMd = fullRebuildMarkdown(content, cols);
      lastSavedMdRef.current = newMd; // mark as our own write so sync doesn't re-parse
      // Update both disk and memory
      saveFile(activeTab, newMd);
      setTabContents({ ...tabContents, [activeTab]: newMd });
    },
    [activeTab, content, saveFile, tabContents, setTabContents]
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
    if (!srcCol || !dstCol) return;

    const cardIdx = srcCol.cards.findIndex((c) => c.id === dragging.cardId);
    if (cardIdx === -1) return;

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
