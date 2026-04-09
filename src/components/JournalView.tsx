import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { CalendarDays, BookOpen, Clock } from 'lucide-react';

/* ─── Helpers ────────────────────────────────────────────── */
const today = () => new Date().toISOString().slice(0, 10);

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function formatDisplayDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ─── Heatmap ────────────────────────────────────────────── */
const DAYS = 7;
const CELL = 13;   // px
const GAP  = 3;    // px
const DAY_LABEL_W = 28; // px

function buildWeekGrid(weeks: number) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const startOfSunday = new Date(now);
  startOfSunday.setDate(now.getDate() - now.getDay() - (weeks - 1) * 7);
  const grid: string[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: string[] = [];
    for (let d = 0; d < DAYS; d++) {
      const day = new Date(startOfSunday);
      day.setDate(startOfSunday.getDate() + w * 7 + d);
      week.push(day.toISOString().slice(0, 10));
    }
    grid.push(week);
  }
  return grid;
}

function heatColor(count: number, max: number): string {
  if (count === 0) return 'rgba(255,255,255,0.05)';
  const t = Math.min(count / Math.max(max, 1), 1);
  const r = Math.round(16  + t * 4);
  const g = Math.round(185 * t + 40 * (1 - t));
  const b = Math.round(90  * (1 - t));
  return `rgba(${r},${g},${b},${0.4 + t * 0.6})`;
}

type HeatmapProps = {
  stats: Record<string, number>;
  onDayClick: (date: string) => void;
};

const Heatmap: React.FC<HeatmapProps> = ({ stats, onDayClick }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(52);

  // Dynamically fit weeks count to available container width
  useEffect(() => {
    if (!wrapRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const availW = entry.contentRect.width - DAY_LABEL_W - 8;
        const colW = CELL + GAP;
        const computed = Math.max(4, Math.floor(availW / colW));
        setWeeks(prev => (prev === computed ? prev : computed));
      }
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  const grid      = useMemo(() => buildWeekGrid(weeks), [weeks]);
  const max       = useMemo(() => Math.max(...Object.values(stats), 1), [stats]);
  const todayStr  = today();
  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const monthLabels = useMemo(() => {
    const labels: { label: string; col: number }[] = [];
    let lastMonth = '';
    grid.forEach((week, wi) => {
      const m = new Date(week[0]).toLocaleString(undefined, { month: 'short' });
      if (m !== lastMonth) { labels.push({ label: m, col: wi }); lastMonth = m; }
    });
    return labels;
  }, [grid]);

  return (
    <div className="heatmap-wrap" ref={wrapRef}>
      {/* Month row */}
      <div className="heatmap-months" style={{ paddingLeft: DAY_LABEL_W }}>
        {monthLabels.map(({ label, col }) => (
          <span
            key={label + col}
            className="heatmap-month-label"
            style={{ position: 'absolute', left: DAY_LABEL_W + col * (CELL + GAP) }}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="heatmap-body">
        {/* Day labels */}
        <div className="heatmap-day-labels" style={{ width: DAY_LABEL_W }}>
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              className="heatmap-day-label"
              style={{ opacity: i % 2 === 1 ? 1 : 0, height: CELL, lineHeight: `${CELL}px` }}
            >
              {d}
            </span>
          ))}
        </div>
        {/* Grid */}
        <div className="heatmap-grid">
          {grid.map((week, wi) => (
            <div key={wi} className="heatmap-col">
              {week.map(date => {
                const count    = stats[date] ?? 0;
                const isToday  = date === todayStr;
                const isFuture = date > todayStr;
                return (
                  <div
                    key={date}
                    className={`heatmap-cell ${isToday ? 'is-today' : ''}`}
                    style={{
                      width: CELL,
                      height: CELL,
                      background: isFuture ? 'transparent' : heatColor(count, max),
                      opacity: isFuture ? 0 : 1,
                      cursor: !isFuture ? 'pointer' : 'default',
                    }}
                    title={isFuture ? '' : `${date}: ${count} words`}
                    onClick={() => !isFuture && onDayClick(date)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── Timeline ───────────────────────────────────────────── */
type TimelineEntry = {
  date: string;
  name: string;
  path: string;
  wordCount: number;
  preview: string;
};

const TimelineView: React.FC<{
  entries: TimelineEntry[];
  onOpen: (path: string) => void;
}> = ({ entries, onOpen }) => {
  let lastMonth = '';
  return (
    <div className="timeline-wrap">
      {entries.map(entry => {
        const month = new Date(entry.date + 'T12:00:00').toLocaleString(undefined, { month: 'long', year: 'numeric' });
        const showHeader = month !== lastMonth;
        lastMonth = month;
        const isDaily = /^\d{4}-\d{2}-\d{2}$/.test(entry.name);
        return (
          <React.Fragment key={entry.path}>
            {showHeader && <div className="timeline-month-header">{month}</div>}
            <div className="timeline-card" onClick={() => onOpen(entry.path)}>
              <div className="timeline-dot" />
              <div className="timeline-card-inner">
                <div className="timeline-card-title">
                  {isDaily && <span className="timeline-daily-badge">📅 Daily</span>}
                  {entry.name}
                </div>
                <div className="timeline-card-meta">
                  {formatDisplayDate(entry.date)} · {entry.wordCount} words
                </div>
                {entry.preview && <div className="timeline-card-preview">{entry.preview}</div>}
              </div>
            </div>
          </React.Fragment>
        );
      })}
      {entries.length === 0 && (
        <div className="timeline-empty">
          <Clock size={40} style={{ opacity: 0.15, marginBottom: 12 }} />
          <div style={{ color: 'var(--tx-3)', fontSize: '0.9rem' }}>No notes yet. Start writing!</div>
        </div>
      )}
    </div>
  );
};

/* ─── Journal View (Root) ────────────────────────────────── */
export const JournalView: React.FC = () => {
  const { allFiles, tabContents, openFile, createFile, journalStats, computeJournalStats, setViewMode } = useStore();
  const [activeView, setActiveView] = useState<'heatmap' | 'timeline'>('heatmap');

  useEffect(() => { computeJournalStats(); }, [allFiles]);

  const handleTodayNote = useCallback(async () => {
    const dateStr = today();
    const { vaultPath } = useStore.getState();
    if (!vaultPath) return;
    const { join } = await import('@tauri-apps/api/path');
    const { exists } = await import('@tauri-apps/plugin-fs');
    const targetPath = await join(vaultPath, `${dateStr}.md`);
    setViewMode('editor');
    if (await exists(targetPath)) {
      await openFile(targetPath);
    } else {
      await createFile(dateStr);
    }
  }, [openFile, createFile, setViewMode]);

  const handleDayClick = useCallback(async (date: string) => {
    const { vaultPath } = useStore.getState();
    if (!vaultPath) return;
    const { join } = await import('@tauri-apps/api/path');
    const { exists } = await import('@tauri-apps/plugin-fs');
    const targetPath = await join(vaultPath, `${date}.md`);
    setViewMode('editor');
    if (await exists(targetPath)) {
      await openFile(targetPath);
    } else {
      await createFile(date);
    }
  }, [openFile, createFile, setViewMode]);

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    return allFiles
      .filter(f => !f.is_dir && f.name.endsWith('.md'))
      .map(f => {
        const name = f.name.replace(/\.md$/, '');
        const dateFromName = /^\d{4}-\d{2}-\d{2}$/.test(name) ? name : null;
        const date = dateFromName ?? '1970-01-01';
        const text = tabContents[f.path] ?? '';
        const preview = text.replace(/#+\s/g, '').trim().slice(0, 120);
        return { date, name, path: f.path, wordCount: wordCount(text), preview };
      })
      .filter(e => e.date !== '1970-01-01')
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allFiles, tabContents]);

  const todayStr   = today();
  const totalWords = Object.values(journalStats).reduce((s, v) => s + v, 0);
  const activeDays = Object.keys(journalStats).filter(d => journalStats[d] > 0).length;
  const streak     = useMemo(() => {
    let count = 0;
    const d = new Date();
    while (journalStats[d.toISOString().slice(0, 10)]) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [journalStats]);

  return (
    <div className="journal-shell">
      {/* Header */}
      <div className="journal-header">
        <div className="journal-header-left">
          <CalendarDays size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="journal-title">Journal</span>
        </div>

        <div className="journal-stats-row">
          <div className="journal-stat">
            <span className="journal-stat-value">{streak}</span>
            <span className="journal-stat-label">streak 🔥</span>
          </div>
          <div className="journal-stat">
            <span className="journal-stat-value">{activeDays}</span>
            <span className="journal-stat-label">days</span>
          </div>
          <div className="journal-stat">
            <span className="journal-stat-value">{totalWords.toLocaleString()}</span>
            <span className="journal-stat-label">words</span>
          </div>
        </div>

        <button className="journal-today-btn" onClick={handleTodayNote}>
          <BookOpen size={14} />
          <span className="journal-today-label">Today</span>
        </button>
      </div>

      {/* Tab switcher */}
      <div className="journal-tabs">
        <button className={`journal-tab ${activeView === 'heatmap' ? 'active' : ''}`} onClick={() => setActiveView('heatmap')}>
          Activity
        </button>
        <button className={`journal-tab ${activeView === 'timeline' ? 'active' : ''}`} onClick={() => setActiveView('timeline')}>
          Timeline
        </button>
      </div>

      {/* Content */}
      <div className="journal-content">
        {activeView === 'heatmap' ? (
          <div className="journal-heatmap-container">
            <div className="heatmap-section-label">
              Writing activity — click any square to open or create that day's note
            </div>
            <Heatmap stats={journalStats} onDayClick={handleDayClick} />
            <div className="heatmap-today-label">
              Today ({todayStr}): <strong>{journalStats[todayStr] ?? 0} words</strong>
            </div>
          </div>
        ) : (
          <TimelineView
            entries={timelineEntries}
            onOpen={p => { setViewMode('editor'); openFile(p); }}
          />
        )}
      </div>
    </div>
  );
};
