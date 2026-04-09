import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KBarProvider, KBarPortal, KBarPositioner,
  KBarAnimator, KBarSearch, KBarResults, useMatches, useRegisterActions, useKBar
} from 'kbar';
import { useStore } from '../store/useStore';
import { FileText, Plus, Share2, Sparkles } from 'lucide-react';
import { AIService } from '../workers/AIService';

/* ─── Result Renderer ────────────────────────────────────── */
const Results: React.FC = () => {
  const { results } = useMatches();
  return (
    <KBarResults
      items={results}
      onRender={({ item, active }) =>
        typeof item === 'string' ? (
          <div className="kbar-section-header">{item}</div>
        ) : (
          <div className={`kbar-result-item ${active ? 'is-active' : ''}`}>
            <div className="kbar-result-left">
              <span className={`kbar-result-icon ${active ? 'kbar-result-is-active' : ''}`}>
                {item.icon ?? <FileText size={16} />}
              </span>
              <div className="kbar-result-text">
                <span className="kbar-result-name">{item.name}</span>
                {item.subtitle && <span className="kbar-result-sub">{item.subtitle}</span>}
              </div>
            </div>
            {item.shortcut?.length ? (
              <div className="kbar-shortcut">
                {item.shortcut.map((s: string) => <span key={s} className="kbar-kbd">{s}</span>)}
              </div>
            ) : null}
          </div>
        )
      }
    />
  );
};

/* ─── Semantic Search Results ────────────────────────────── */
const SemanticResults: React.FC<{
  results: { path: string; label: string; score: number }[];
  onPick: (path: string) => void;
}> = ({ results, onPick }) => {
  if (!results.length) return null;
  return (
    <div className="semantic-results">
      <div className="kbar-section-header">
        <Sparkles size={11} style={{ marginRight: 5, color: 'var(--accent)' }} />
        AI Semantic Matches
      </div>
      {results.map(r => (
        <div
          key={r.path}
          className="kbar-result-item semantic-item"
          onClick={() => onPick(r.path)}
        >
          <div className="kbar-result-left">
            <span className="kbar-result-icon semantic-icon">
              <Sparkles size={14} />
            </span>
            <div className="kbar-result-text">
              <span className="kbar-result-name">{r.label}</span>
              <span className="kbar-result-sub">
                {Math.round(r.score * 100)}% semantic match
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── AI Status Badge ────────────────────────────────────── */
const AIBadge: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'ready') return null;
  return (
    <div className="ai-badge">
      {status === 'loading' ? (
        <><span className="ai-badge-dot loading" />Loading AI model…</>
      ) : (
        <><span className="ai-badge-dot" />AI search ready</>
      )}
    </div>
  );
};

/* ─── CommandBar Content ─────────────────────────────────── */
const CommandBarContent: React.FC = () => {
  const { allFiles, openFile, setViewMode, createFile, aiIndex } = useStore();
  const { query } = useKBar();
  const [aiStatus, setAiStatus]           = useState<string>('idle');
  const [semanticHits, setSemanticHits]   = useState<{ path: string; label: string; score: number }[]>([]);
  const searchDebounce                    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastQuery                         = useRef('');

  // Bootstrap AI engine once
  useEffect(() => {
    const unsub = AIService.onStatus(setAiStatus);
    AIService.init().catch(console.error);
    return unsub;
  }, []);

  // Listen to kbar query changes and run semantic search
  useEffect(() => {
    const el = document.querySelector('.kbar-search') as HTMLInputElement | null;
    if (!el) return;
    const handler = () => {
      const q = el.value.trim();
      if (q === lastQuery.current) return;
      lastQuery.current = q;
      if (searchDebounce.current !== undefined) clearTimeout(searchDebounce.current);
      if (q.length < 3 || aiStatus !== 'ready' || !aiIndex.length) {
        setSemanticHits([]);
        return;
      }
      searchDebounce.current = setTimeout(async () => {
        try {
          const qVec  = await AIService.embedQuery(q);
          const hits  = await AIService.search(qVec, aiIndex, 4);
          setSemanticHits(hits.filter(h => h.score > 0.25));
        } catch { setSemanticHits([]); }
      }, 350);
    };
    el.addEventListener('input', handler);
    return () => { el.removeEventListener('input', handler); if (searchDebounce.current !== undefined) clearTimeout(searchDebounce.current); };
  }, [aiStatus, aiIndex]);

  const actions = useMemo(() => {
    const fileActions = allFiles
      .filter(f => !f.is_dir && f.name.endsWith('.md'))
      .map(file => ({
        id: `open-${file.path}`,
        name: file.name.replace(/\.md$/, ''),
        keywords: file.name,
        section: 'Files',
        subtitle: (() => {
          const parts = file.path.split('/');
          return parts.length >= 2 ? parts[parts.length - 2] : 'Vault';
        })(),
        perform: () => { openFile(file.path); setViewMode('editor'); },
        icon: <FileText size={16} />,
      }));

    return [
      { id: 'new-note',    name: 'New Note',        shortcut: ['n'], keywords: 'create new note', section: 'Actions', perform: () => createFile('Untitled'), icon: <Plus size={16} /> },
      { id: 'graph-view',  name: 'Open Graph View', shortcut: ['g'], keywords: 'graph',            section: 'Actions', perform: () => setViewMode('graph'),    icon: <Share2 size={16} /> },
      ...fileActions,
    ];
  }, [allFiles, openFile, setViewMode, createFile]);

  useRegisterActions(actions, [actions]);

  return (
    <KBarPortal>
      <KBarPositioner className="kbar-positioner">
        <KBarAnimator className="kbar-animator">
          <div className="kbar-search-row">
            <Search16 />
            <KBarSearch className="kbar-search" defaultPlaceholder="Search notes or type a command…" />
          </div>
          <AIBadge status={aiStatus} />
          <SemanticResults
            results={semanticHits}
            onPick={path => { openFile(path); setViewMode('editor'); query.toggle(); setSemanticHits([]); }}
          />
          <div className="kbar-results-wrapper">
            <Results />
          </div>
        </KBarAnimator>
      </KBarPositioner>
    </KBarPortal>
  );
};

/* ─── Provider ───────────────────────────────────────────── */
export const CommandBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <KBarProvider>
    <CommandBarContent />
    {children}
  </KBarProvider>
);

const Search16 = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="var(--tx-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);
