import React, { useMemo, useState } from 'react';
import { CheckSquare, Square, ListTodo, FileText, Hash, CalendarClock, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { useStore, getVaultIndex } from '../store/useStore';
import { TaskEntry, toggleTaskLine, taskDisplayText } from '../vaultIndex';

type GroupBy = 'due' | 'note' | 'tag';

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dueBucket(task: TaskEntry, todayISO: string): string {
  if (!task.due) return 'No date';
  if (task.due < todayISO) return 'Overdue';
  if (task.due === todayISO) return 'Today';
  const in7 = localISO(new Date(Date.now() + 7 * 86_400_000));
  if (task.due <= in7) return 'This week';
  return 'Later';
}

const DUE_ORDER = ['Overdue', 'Today', 'This week', 'Later', 'No date'];

function groupTasks(tasks: TaskEntry[], groupBy: GroupBy, todayISO: string): [string, TaskEntry[]][] {
  const groups = new Map<string, TaskEntry[]>();
  const push = (key: string, t: TaskEntry) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  };

  for (const t of tasks) {
    if (groupBy === 'due') push(dueBucket(t, todayISO), t);
    else if (groupBy === 'note') push(t.notePath.split(/[/\\]/).pop()?.replace(/\.md$/, '') ?? 'Note', t);
    else if (t.tags.length === 0) push('untagged', t);
    else t.tags.forEach(tag => push(`#${tag}`, t));
  }

  const entries = [...groups.entries()];
  if (groupBy === 'due') {
    entries.sort((a, b) => DUE_ORDER.indexOf(a[0]) - DUE_ORDER.indexOf(b[0]));
    // within each due group: soonest first
    entries.forEach(([, list]) => list.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')));
  } else {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return entries;
}

export const TasksView: React.FC = () => {
  const { indexVersion, openFile, saveFile, tabContents } = useStore();
  const [groupBy, setGroupBy] = useState<GroupBy>('due');
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const todayISO = localISO(new Date());

  const { open, done } = useMemo(() => {
    void indexVersion; // recompute whenever the index changes
    const all = getVaultIndex().allTasks();
    return {
      open: all.filter(t => !t.checked),
      done: all.filter(t => t.checked),
    };
  }, [indexVersion]);

  const groups = useMemo(
    () => groupTasks(showDone ? [...open, ...done] : open, groupBy, todayISO),
    [open, done, showDone, groupBy, todayISO],
  );

  const overdueCount = useMemo(() => open.filter(t => t.due && t.due < todayISO).length, [open, todayISO]);
  const todayCount = useMemo(() => open.filter(t => t.due === todayISO).length, [open, todayISO]);

  const toggle = async (task: TaskEntry) => {
    try {
      const cached = tabContents[task.notePath];
      const content = cached !== undefined ? cached : await readTextFile(task.notePath);
      const updated = toggleTaskLine(content, task.line, task.text);
      if (updated === null) {
        // Note changed since indexing — refresh this note's entry and retry once
        getVaultIndex().updateNote(task.notePath, content);
        useStore.setState(s => ({ indexVersion: s.indexVersion + 1 }));
        toast('Note changed — task list refreshed, try again.', { icon: '↻' });
        return;
      }
      await saveFile(task.notePath, updated); // saveFile re-indexes + bumps version
    } catch (e: any) {
      toast.error(`Could not toggle task: ${e?.message ?? e}`);
    }
  };

  const toggleGroup = (name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  return (
    <div className="tasks-shell">
      <div className="tasks-topbar">
        <div className="tasks-topbar-left">
          <ListTodo size={16} style={{ color: 'var(--accent)' }} />
          <span className="tasks-title">Tasks</span>
          <span className="tasks-counts">
            {open.length} open
            {overdueCount > 0 && <span className="tasks-overdue-badge">{overdueCount} overdue</span>}
            {todayCount > 0 && <span className="tasks-today-badge">{todayCount} today</span>}
          </span>
        </div>
        <div className="tasks-topbar-right">
          <div className="tasks-groupby">
            {([['due', <CalendarClock size={13} key="d" />], ['note', <FileText size={13} key="n" />], ['tag', <Hash size={13} key="t" />]] as [GroupBy, React.ReactNode][]).map(([id, icon]) => (
              <button
                key={id}
                className={`tasks-groupby-btn ${groupBy === id ? 'active' : ''}`}
                onClick={() => setGroupBy(id)}
                title={`Group by ${id}`}
              >
                {icon} {id}
              </button>
            ))}
          </div>
          <label className="tasks-showdone">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            show done
          </label>
        </div>
      </div>

      <div className="tasks-body">
        {groups.length === 0 && (
          <div className="tasks-empty">
            <ListTodo size={42} style={{ opacity: 0.15, marginBottom: 10 }} />
            <div className="empty-state-title">No open tasks</div>
            <div className="empty-state-hint">
              Add <code>- [ ] task</code> to any note — with <code>@due(2026-12-31)</code> and <code>#tags</code> if you like.
            </div>
          </div>
        )}
        {groups.map(([name, tasks]) => (
          <div key={name} className="tasks-group">
            <button className="tasks-group-header" onClick={() => toggleGroup(name)}>
              {collapsed.has(name) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span className={`tasks-group-name ${name === 'Overdue' ? 'is-overdue' : ''} ${name === 'Today' ? 'is-today' : ''}`}>
                {name}
              </span>
              <span className="tasks-group-count">{tasks.length}</span>
            </button>
            {!collapsed.has(name) && tasks.map(task => (
              <div key={`${task.notePath}:${task.line}:${task.checked}`} className={`task-row ${task.checked ? 'done' : ''}`}>
                <button className="task-check" onClick={() => toggle(task)} title={task.checked ? 'Mark open' : 'Mark done'}>
                  {task.checked
                    ? <CheckSquare size={15} style={{ color: 'var(--accent)' }} />
                    : <Square size={15} style={{ color: 'var(--tx-3)' }} />}
                </button>
                <span className="task-text">{taskDisplayText(task.text)}</span>
                {task.due && (
                  <span className={`task-due ${!task.checked && task.due < todayISO ? 'overdue' : ''} ${task.due === todayISO ? 'today' : ''}`}>
                    {task.due}
                  </span>
                )}
                <button className="task-note" onClick={() => openFile(task.notePath)} title="Open note">
                  <FileText size={12} />
                  {task.notePath.split(/[/\\]/).pop()?.replace(/\.md$/, '')}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Once per day, notify about due/overdue tasks. Called by App after the
 * vault index reconciles. No-op outside Tauri or when nothing is due.
 */
export async function notifyDueTasks(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const todayISO = localISO(new Date());
  if (localStorage.getItem('nopes_last_task_notif') === todayISO) return;

  const openTasks = getVaultIndex().allTasks().filter(t => !t.checked && t.due);
  const overdue = openTasks.filter(t => t.due! < todayISO).length;
  const today = openTasks.filter(t => t.due === todayISO).length;

  // Due flashcards ride the same daily nudge
  let dueCards = 0;
  try {
    const { getSrsStore } = await import('../srs');
    const vaultPath = useStore.getState().vaultPath;
    if (vaultPath) {
      const srs = await getSrsStore(vaultPath);
      const suspended = new Set(srs.suspended);
      dueCards = getVaultIndex().allCards()
        .filter(c => !suspended.has(c.key))
        .filter(c => srs.states[c.key] && srs.states[c.key].dueISO <= todayISO).length;
    }
  } catch { /* srs store unreadable — skip count */ }

  if (overdue + today + dueCards === 0) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    const parts = [
      today > 0 ? `${today} task${today > 1 ? 's' : ''} due today` : '',
      overdue > 0 ? `${overdue} overdue` : '',
      dueCards > 0 ? `${dueCards} flashcard${dueCards > 1 ? 's' : ''} to review` : '',
    ].filter(Boolean);
    sendNotification({ title: 'NoPes Tasks', body: parts.join(' · ') });
    localStorage.setItem('nopes_last_task_notif', todayISO);
  } catch (e) {
    console.warn('[NoPes:tasks] Notification failed:', e);
  }
}
