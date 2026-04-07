import React, { useMemo } from 'react';
import {
  KBarProvider, KBarPortal, KBarPositioner,
  KBarAnimator, KBarSearch, KBarResults, useMatches, useRegisterActions
} from 'kbar';
import { useStore } from '../store/useStore';
import { FileText, Plus, Share2 } from 'lucide-react';

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
                {item.subtitle && (
                  <span className="kbar-result-sub">{item.subtitle}</span>
                )}
              </div>
            </div>
            {item.shortcut?.length ? (
              <div className="kbar-shortcut">
                {item.shortcut.map((s: string) => (
                  <span key={s} className="kbar-kbd">{s}</span>
                ))}
              </div>
            ) : null}
          </div>
        )
      }
    />
  );
};

/* ─── CommandBar Content (Registers Actions Dynamically) ─── */
const CommandBarContent: React.FC = () => {
  const { allFiles, openFile, setViewMode, createFile } = useStore();

  const actions = useMemo(() => {
    const fileActions = allFiles.map(file => ({
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
      {
        id: 'new-note',
        name: 'New Note',
        shortcut: ['n'],
        keywords: 'create new note',
        section: 'Actions',
        perform: () => createFile('Untitled'),
        icon: <Plus size={16} />,
      },
      {
        id: 'graph-view',
        name: 'Open Graph View',
        shortcut: ['g'],
        keywords: 'graph connections',
        section: 'Actions',
        perform: () => setViewMode('graph'),
        icon: <Share2 size={16} />,
      },
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
            <KBarSearch
              className="kbar-search"
              defaultPlaceholder="Search notes or type a command…"
            />
          </div>
          <div className="kbar-results-wrapper">
            <Results />
          </div>
        </KBarAnimator>
      </KBarPositioner>
    </KBarPortal>
  );
};

/* ─── CommandBar Provider ────────────────────────────────── */
export const CommandBar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <KBarProvider>
      <CommandBarContent />
      {children}
    </KBarProvider>
  );
};

/* tiny inline icon to avoid import */ 
const Search16 = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="var(--tx-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);
