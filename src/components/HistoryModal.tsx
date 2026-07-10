import React, { useEffect, useMemo, useState } from 'react';
import { History, X, RotateCcw, FileClock } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { listSnapshots, readSnapshot, maybeSnapshotNote, SnapshotInfo } from '../history';
import { diffLines, diffStats, DiffLine } from '../diff';

function relativeLabel(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d ago`;
  return d.toLocaleDateString();
}

export const HistoryModal: React.FC<{ notePath: string; onClose: () => void }> = ({ notePath, onClose }) => {
  const { vaultPath, tabContents, saveFile } = useStore();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [selected, setSelected] = useState<SnapshotInfo | null>(null);
  const [snapshotText, setSnapshotText] = useState<string>('');
  const [restoring, setRestoring] = useState(false);

  const currentContent = tabContents[notePath] ?? '';

  useEffect(() => {
    let active = true;
    listSnapshots(vaultPath!, notePath).then(list => {
      if (!active) return;
      setSnapshots(list);
      if (list.length > 0) setSelected(list[0]);
    }).catch(() => active && setSnapshots([]));
    return () => { active = false; };
  }, [vaultPath, notePath]);

  useEffect(() => {
    let active = true;
    if (!selected) { setSnapshotText(''); return; }
    readSnapshot(selected.path)
      .then(t => active && setSnapshotText(t))
      .catch(() => active && setSnapshotText(''));
    return () => { active = false; };
  }, [selected]);

  const diff: DiffLine[] = useMemo(
    () => (selected ? diffLines(snapshotText, currentContent) : []),
    [snapshotText, currentContent, selected],
  );
  const stats = useMemo(() => diffStats(diff), [diff]);

  const handleRestore = async () => {
    if (!selected || restoring) return;
    setRestoring(true);
    try {
      // Preserve the CURRENT state first — restoring must never lose data.
      await maybeSnapshotNote(vaultPath, notePath, { force: true });
      await saveFile(notePath, snapshotText);
      toast.success(`Restored version from ${relativeLabel(selected.date)}`);
      onClose();
    } catch (e: any) {
      toast.error(`Restore failed: ${e?.message ?? e}`);
    } finally {
      setRestoring(false);
    }
  };

  const noteName = notePath.split(/[/\\]/).pop()?.replace(/\.md$/, '') ?? 'Note';

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="history-modal" onClick={e => e.stopPropagation()}>
        <div className="history-header">
          <div className="history-title">
            <History size={16} />
            <span>Version History — {noteName}</span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="history-body">
          <div className="history-list">
            {snapshots === null && <div className="history-empty">Loading…</div>}
            {snapshots?.length === 0 && (
              <div className="history-empty">
                <FileClock size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
                <div>No snapshots yet.</div>
                <div className="history-empty-hint">Versions are saved automatically as you edit (about once a minute).</div>
              </div>
            )}
            {snapshots?.map(s => (
              <button
                key={s.path}
                className={`history-item ${selected?.path === s.path ? 'is-active' : ''}`}
                onClick={() => setSelected(s)}
              >
                <span className="history-item-rel">{relativeLabel(s.date)}</span>
                <span className="history-item-abs">{s.date.toLocaleString()}</span>
              </button>
            ))}
          </div>

          <div className="history-diff">
            {selected ? (
              <>
                <div className="history-diff-toolbar">
                  <span className="history-diff-stats">
                    Selected version → current:&nbsp;
                    <span className="diff-added">+{stats.added}</span>&nbsp;
                    <span className="diff-removed">−{stats.removed}</span>
                  </span>
                  <button className="history-restore-btn" onClick={handleRestore} disabled={restoring}>
                    <RotateCcw size={13} />
                    {restoring ? 'Restoring…' : 'Restore this version'}
                  </button>
                </div>
                <div className="history-diff-lines">
                  {diff.map((l, i) => (
                    <div key={i} className={`diff-line diff-${l.type}`}>
                      <span className="diff-gutter">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                      <span className="diff-text">{l.text || ' '}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="history-empty">Select a version to compare.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
