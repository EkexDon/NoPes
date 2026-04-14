import React, { useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { CheckSquare, Square, Plus, Kanban } from 'lucide-react';

interface KanbanCard {
  id: string;
  text: string;
  checked: boolean;
  rawLine: string;
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

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentCol = {
        id: crypto.randomUUID(),
        title: headingMatch[1].trim(),
        cards: [],
      };
      columns.push(currentCol);
      continue;
    }
    if (currentCol) {
      const uncheckedMatch = line.match(/^- \[ \] (.+)$/);
      const checkedMatch = line.match(/^- \[x\] (.+)$/i);
      if (uncheckedMatch || checkedMatch) {
        const text = (uncheckedMatch || checkedMatch)![1];
        currentCol.cards.push({
          id: crypto.randomUUID(),
          text,
          checked: !!checkedMatch,
          rawLine: line,
        });
      }
    }
  }

  return columns;
}

function fullRebuildMarkdown(
  original: string,
  columns: KanbanColumn[]
): string {
  const lines = original.split('\n');
  const output: string[] = [];
  let insideKanban = false;
  let currentColTitle: string | null = null;
  const writtenCols = new Set<string>();

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const title = h2[1].trim();
      const matchedCol = columns.find((c) => c.title.trim() === title);
      if (matchedCol) {
        // Flush current column cards
        if (insideKanban && currentColTitle) {
          // already written inline below
        }
        output.push(line); // column heading
        insideKanban = true;
        currentColTitle = title;
        writtenCols.add(title);

        // Write all cards for this column now
        for (const card of matchedCol.cards) {
          output.push(`- [${card.checked ? 'x' : ' '}] ${card.text}`);
        }
        continue;
      } else {
        insideKanban = false;
        currentColTitle = null;
        output.push(line);
        continue;
      }
    }

    // Skip original checkbox lines that belong to a kanban column (already written above)
    if (insideKanban && (line.match(/^- \[ \] /) || line.match(/^- \[x\] /i))) {
      continue;
    }

    // Skip blank lines after column headings when rebuilding (they'll be added back)
    output.push(line);
  }

  return output.join('\n');
}

export const KanbanView: React.FC = () => {
  const { activeTab, tabContents, saveFile } = useStore();
  const content = activeTab ? (tabContents[activeTab] ?? '') : '';

  const [localColumns, setLocalColumns] = useState<KanbanColumn[]>(() => parseKanban(content));

  // Drag state
  const [dragging, setDragging] = useState<{
    colId: string;
    cardId: string;
  } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const persist = useCallback(
    (cols: KanbanColumn[]) => {
      if (!activeTab) return;
      const newMd = fullRebuildMarkdown(content, cols);
      saveFile(activeTab, newMd);
    },
    [activeTab, content, saveFile]
  );

  const handleDragStart = (colId: string, cardId: string) => {
    setDragging({ colId, cardId });
  };

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

  const addCard = (colId: string) => {
    const text = prompt('New task:');
    if (!text?.trim()) return;
    const newCols = localColumns.map((col) => {
      if (col.id !== colId) return col;
      return {
        ...col,
        cards: [
          ...col.cards,
          { id: crypto.randomUUID(), text: text.trim(), checked: false, rawLine: `- [ ] ${text.trim()}` },
        ],
      };
    });
    setLocalColumns(newCols);
    persist(newCols);
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
          Add <code>##</code> headings and <code>- [ ]</code> tasks to this note to see them here
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
                  onDragStart={() => handleDragStart(col.id, card.id)}
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
              <button className="kanban-add-card" onClick={() => addCard(col.id)}>
                <Plus size={12} /> Add card
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
