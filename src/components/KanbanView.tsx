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

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentCol = {
        id: `col-${headingMatch[1].trim()}`,
        title: headingMatch[1].trim(),
        cards: [],
      };
      columns.push(currentCol);
      continue;
    }

    const cbMatch = line.match(checkboxRe);
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
  const lines = original.split('\n');
  const output: string[] = [];
  let insideKanban = false;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const title = h2[1].trim();
      const matchedCol = columns.find((c) => c.title.trim() === title);
      if (matchedCol) {
        output.push(line);
        insideKanban = true;
        for (const card of matchedCol.cards) {
          output.push(`- [${card.checked ? 'x' : ' '}] ${card.text}`);
        }
        continue;
      } else {
        insideKanban = false;
        output.push(line);
        continue;
      }
    }
    // Skip old checkbox lines inside a kanban section (already rewritten above)
    if (insideKanban && (line.match(/^- \[ \] /) || line.match(/^- \[x\] /i))) {
      continue;
    }
    output.push(line);
  }

  return output.join('\n');
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
      return;
    }
    // Same tab — only re-parse if content was changed EXTERNALLY (i.e. by the Editor, not by us)
    if (content !== lastSavedMdRef.current) {
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
