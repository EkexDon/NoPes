import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KBarProvider, KBarPortal, KBarPositioner,
  KBarAnimator, KBarSearch, KBarResults, useMatches, useRegisterActions, useKBar
} from 'kbar';
import { useStore } from '../store/useStore';
import { THEMES } from '../themes';
import { FileText, Plus, Share2, Sparkles, Search, LayoutTemplate, Palette } from 'lucide-react';
import { AIService } from '../workers/AIService';
import Fuse from 'fuse.js';

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
const AIBadge: React.FC<{ status: string; enabled: boolean }> = ({ status, enabled }) => {
  if (!enabled || status === 'ready') return null;
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

/* ─── Full-Text Search Results ───────────────────────────── */
const FullTextSearchResults: React.FC<{
  results: { path: string; label: string; matches: string[]; score: number }[];
  onPick: (path: string) => void;
}> = ({ results, onPick }) => {
  if (!results.length) return null;
  return (
    <div className="semantic-results">
      <div className="kbar-section-header">
        <Search size={11} style={{ marginRight: 5, color: 'var(--accent)' }} />
        Content Matches
      </div>
      {results.map(r => (
        <div
          key={r.path}
          className="kbar-result-item semantic-item"
          onClick={() => onPick(r.path)}
        >
          <div className="kbar-result-left">
            <span className="kbar-result-icon semantic-icon">
              <FileText size={14} />
            </span>
            <div className="kbar-result-text">
              <span className="kbar-result-name">{r.label}</span>
              <span className="kbar-result-sub">
                {r.matches.slice(0, 2).join(' ... ')}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── Template Results ─────────────────────────────────── */
const TemplateResults: React.FC<{
  templates: { id: string; name: string; category: string }[];
  onPick: (id: string) => void;
}> = ({ templates, onPick }) => {
  if (!templates.length) return null;
  return (
    <div className="semantic-results">
      <div className="kbar-section-header">
        <LayoutTemplate size={11} style={{ marginRight: 5, color: 'var(--accent)' }} />
        Templates
      </div>
      {templates.map(t => (
        <div
          key={t.id}
          className="kbar-result-item semantic-item"
          onClick={() => onPick(t.id)}
        >
          <div className="kbar-result-left">
            <span className="kbar-result-icon semantic-icon">
              <LayoutTemplate size={14} />
            </span>
            <div className="kbar-result-text">
              <span className="kbar-result-name">{t.name}</span>
              <span className="kbar-result-sub">{t.category}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── CommandBar Content ─────────────────────────────────── */
const CommandBarContent: React.FC = () => {
  const { allFiles, openFile, setViewMode, createFile, createFileFromTemplate, aiIndex, isAiEnabled, templates, buildSearchIndex, searchIndex, setTheme } = useStore();
  const { query, searchQuery, showing } = useKBar(state => ({
    searchQuery: state.searchQuery,
    showing: state.visualState !== 'hidden',
  }));
  const [aiStatus, setAiStatus]           = useState<string>('idle');
  const [semanticHits, setSemanticHits]   = useState<{ path: string; label: string; score: number }[]>([]);
  const [fullTextHits, setFullTextHits]   = useState<{ path: string; label: string; matches: string[]; score: number }[]>([]);
  const [templateHits, setTemplateHits]   = useState<{ id: string; name: string; category: string }[]>([]);
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [newNoteName, setNewNoteName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const searchDebounce                    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastQuery                         = useRef('');
  const fuseRef                           = useRef<Fuse<{ path: string; content: string }> | null>(null);

  // (Re)build the full-text index whenever the palette opens, so
  // results reflect edits made since the last search.
  useEffect(() => {
    if (showing) buildSearchIndex();
  }, [showing, buildSearchIndex]);

  // Initialize Fuse when searchIndex changes
  useEffect(() => {
    if (searchIndex.size === 0) return;
    const docs = Array.from(searchIndex.entries()).map(([path, content]) => ({ path, content }));
    fuseRef.current = new Fuse(docs, {
      keys: ['content'],
      threshold: 0.3,
      includeMatches: true,
      distance: 100,
    });
  }, [searchIndex]);

  // Track worker status, but keep model lazy to avoid idle memory usage.
  useEffect(() => {
    const unsub = AIService.onStatus(setAiStatus);
    return unsub;
  }, []);

  // React to kbar query changes and run searches. Reading kbar's own
  // state (instead of a DOM listener on '.kbar-search') works even
  // though the input only exists while the portal is open.
  useEffect(() => {
      const q = (searchQuery || '').trim();
      if (q === lastQuery.current) return;
      lastQuery.current = q;
      if (searchDebounce.current !== undefined) clearTimeout(searchDebounce.current);

      // Full-text search with Fuse
      if (q.length >= 2 && fuseRef.current) {
        const fuseResults = fuseRef.current.search(q, { limit: 5 });
        const hits = fuseResults.map(r => {
          const path = r.item.path;
          const label = path.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? 'Note';
          const matches = r.matches?.[0]?.indices?.slice(0, 3).map(([start, end]: [number, number]) => {
            const snippetStart = Math.max(0, start - 30);
            const snippetEnd = Math.min(r.item.content.length, end + 30);
            return '...' + r.item.content.slice(snippetStart, snippetEnd) + '...';
          }) || [];
          return { path, label, matches, score: r.score! };
        });
        setFullTextHits(hits);
      } else {
        setFullTextHits([]);
      }

      // Template search
      if (q.length >= 1) {
        const templateMatches = templates.filter(t =>
          t.name.toLowerCase().includes(q.toLowerCase()) ||
          t.category.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 5);
        setTemplateHits(templateMatches);
      } else {
        setTemplateHits([]);
      }

      // AI semantic search
      if (q.length < 3 || !isAiEnabled || !aiIndex.length) {
        setSemanticHits([]);
        return;
      }
      if (aiStatus === 'idle') {
        AIService.init().catch(console.error);
        return;
      }
      if (aiStatus !== 'ready') return;
      searchDebounce.current = setTimeout(async () => {
        try {
          const qVec  = await AIService.embedQuery(q);
          const hits  = await AIService.search(qVec, aiIndex, 4);
          setSemanticHits(hits.filter(h => h.score > 0.25));
        } catch { setSemanticHits([]); }
      }, 350);
    return () => { if (searchDebounce.current !== undefined) clearTimeout(searchDebounce.current); };
  }, [searchQuery, aiStatus, aiIndex, isAiEnabled, templates, searchIndex]);

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

    const themeActions = THEMES.map(t => ({
      id: `theme-${t.id}`,
      name: `Theme: ${t.label}`,
      keywords: `theme appearance style ${t.label} ${t.dark ? 'dark' : 'light'}`,
      section: 'Appearance',
      perform: () => setTheme(t.id),
      icon: <Palette size={16} />,
    }));

    return [
      { id: 'new-note',    name: 'New Note',        shortcut: ['n'], keywords: 'create new note', section: 'Actions', perform: () => createFile('Untitled'), icon: <Plus size={16} /> },
      { id: 'new-from-template', name: 'New from Template', shortcut: ['t'], keywords: 'template', section: 'Actions', perform: () => setShowNewNoteModal(true), icon: <LayoutTemplate size={16} /> },
      { id: 'graph-view',  name: 'Open Graph View', shortcut: ['g'], keywords: 'graph',            section: 'Actions', perform: () => setViewMode('graph'),    icon: <Share2 size={16} /> },
      ...themeActions,
      ...fileActions,
    ];
  }, [allFiles, openFile, setViewMode, createFile, setTheme]);

  useRegisterActions(actions, [actions]);

  const handleCreateFromTemplate = () => {
    if (!newNoteName.trim()) return;
    if (selectedTemplateId) {
      createFileFromTemplate(newNoteName, selectedTemplateId);
    } else {
      createFile(newNoteName);
    }
    setShowNewNoteModal(false);
    setNewNoteName('');
    setSelectedTemplateId('');
    query.toggle();
  };

  return (
    <>
      <KBarPortal>
        <KBarPositioner className="kbar-positioner">
          <KBarAnimator className="kbar-animator">
            <div className="kbar-search-row">
              <Search16 />
              <KBarSearch className="kbar-search" defaultPlaceholder="Search notes, content, or templates…" />
            </div>
            <AIBadge status={aiStatus} enabled={isAiEnabled && aiIndex.length > 0} />
            <FullTextSearchResults
              results={fullTextHits}
              onPick={path => { openFile(path); setViewMode('editor'); query.toggle(); setFullTextHits([]); }}
            />
            <TemplateResults
              templates={templateHits}
              onPick={id => {
                setShowNewNoteModal(true);
                setSelectedTemplateId(id);
              }}
            />
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

      {showNewNoteModal && (
        <div className="modal-overlay" onClick={() => setShowNewNoteModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Create New Note</div>
            <label className="modal-label">Note Name</label>
            <input
              className="modal-input"
              value={newNoteName}
              onChange={e => setNewNoteName(e.target.value)}
              placeholder="e.g., Meeting Notes"
              autoFocus
            />
            <label className="modal-label">Template (optional)</label>
            <select
              className="modal-input"
              value={selectedTemplateId}
              onChange={e => setSelectedTemplateId(e.target.value)}
            >
              <option value="">None (blank note)</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
              ))}
            </select>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setShowNewNoteModal(false)}>Cancel</button>
              <button className="modal-btn primary" onClick={handleCreateFromTemplate} disabled={!newNoteName.trim()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
