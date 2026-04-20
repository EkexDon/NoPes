import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { NoteEditor } from './components/NoteEditor';
import { GraphView } from './components/GraphView';
import { CommandBar } from './components/CommandBar';
import { JournalView } from './components/JournalView';
import { useStore } from './store/useStore';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  FileText, Share2, Search, Settings,
  PanelLeftClose, PanelLeftOpen, Plus, X,
  Shield, Palette, Keyboard, CalendarDays, Bot, Kanban
} from 'lucide-react';
import { useKBar } from 'kbar';
import { Toaster } from 'react-hot-toast';
import { VaultChat } from './components/VaultChat';
import { CanvasView } from './components/CanvasView';
import { KanbanView } from './components/KanbanView';

/* ─── Error Boundary ─────────────────────────────────────── */
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: any) { console.error('ErrorBoundary caught:', error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', background: 'var(--bg-0)', color: 'var(--tx-1)', height: '100vh', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2>Whoops, Nopes crashed! (The Black Screen)</h2>
          <pre style={{ background: '#300', padding: '16px', borderRadius: '4px', overflow: 'auto', fontSize: '13px' }}>
            {this.state.error?.stack || this.state.error?.message}
          </pre>
          <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: '4px', background: 'var(--accent)', alignSelf: 'flex-start', color: '#fff' }}>Reload Application</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Settings Modal ─────────────────────────────────────── */
type SettingsTab = 'general' | 'appearance' | 'hotkeys';

const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { vaultPath } = useStore();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [stats, setStats] = useState({ app: '—', ollama: '—' });

  useEffect(() => {
    const fetch = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res: any = await invoke('get_system_stats');
        setStats({ 
          app: res.app_mb > 1024 ? (res.app_mb / 1024).toFixed(1) + ' GB' : res.app_mb + ' MB',
          ollama: res.ollama_mb > 1024 ? (res.ollama_mb / 1024).toFixed(1) + ' GB' : res.ollama_mb + ' MB'
        });
      } catch {}
    };
    fetch();
    const iv = setInterval(fetch, 3000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-sidebar">
          <div className="settings-sidebar-title">Settings</div>
          {([
            ['general',    <Shield size={15} />,   'General'],
            ['appearance', <Palette size={15} />,  'Appearance'],
            ['hotkeys',    <Keyboard size={15} />, 'Hotkeys'],
          ] as [SettingsTab, React.ReactNode, string][]).map(([id, icon, label]) => (
            <div key={id} className={`settings-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
              {icon}{label}
            </div>
          ))}
        </div>
        <div className="settings-content">
          <div className="settings-content-header">
            <div className="settings-content-title">{tab.charAt(0).toUpperCase() + tab.slice(1)}</div>
            <button className="icon-btn" onClick={onClose} style={{ color: 'var(--tx-2)' }}>
              <X size={18} />
            </button>
          </div>
          {tab === 'general' && (
            <>
              <div className="setting-row">
                <div>
                  <div className="setting-info-label">Vault Location</div>
                  <div className="setting-info-desc">Directory where your notes are stored.</div>
                </div>
                <code className="setting-value">{vaultPath ?? '—'}</code>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-info-label">Auto-save</div>
                  <div className="setting-info-desc">Notes save automatically as you type (400ms debounce).</div>
                </div>
                <label className="nopes-switch">
                  <input 
                    type="checkbox" 
                    checked={useStore.getState().isAutoSaveEnabled} 
                    onChange={(e) => useStore.getState().setAutoSaveEnabled(e.target.checked)}
                  />
                  <span className="nopes-slider"></span>
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-info-label">Enable AI Features</div>
                  <div className="setting-info-desc">Local semantic search and AI Chat (powered by Ollama). Disable to save memory/battery.</div>
                </div>
                <label className="nopes-switch">
                  <input 
                    type="checkbox" 
                    checked={useStore.getState().isAiEnabled} 
                    onChange={(e) => useStore.getState().setAiEnabled(e.target.checked)}
                  />
                  <span className="nopes-slider"></span>
                </label>
              </div>

              <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--bd-1)' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--tx-3)', marginBottom: '12px', letterSpacing: '0.05em', fontWeight: 600 }}>System Resources</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <ResourceStat label="App + Webview" value={stats.app} />
                  <ResourceStat label="Ollama Service" value={stats.ollama} />
                </div>
                <div style={{ fontSize: '11px', color: 'var(--tx-3)', marginTop: '12px', fontStyle: 'italic' }}>
                  * AI Worker automatically kills itself after 5 mins of inactivity.
                </div>
              </div>
            </>
          )}
          {tab === 'appearance' && (
            <div className="setting-row">
              <div>
                <div className="setting-info-label">Theme</div>
                <div className="setting-info-desc">Visual style.</div>
              </div>
              <span className="setting-value">Dark (Obsidian)</span>
            </div>
          )}
          {tab === 'hotkeys' && (
            <>
              {([
                ['Search / Command Palette', '⌘', 'K'],
                ['Toggle Sidebar',           '⌘', 'B'],
                ['Switch to Editor',         '⌘', 'E'],
                ['Switch to Graph',          '⌘', 'G'],
                ['New Note',                 '⌘', 'N'],
                ['Close Tab',                '⌘', 'W'],
              ] as [string, string, string][]).map(([action, mod, key]) => (
                <div className="hotkey-row" key={action}>
                  <span className="hotkey-action">{action}</span>
                  <div className="hotkey-keys">
                    <span className="hotkey-key">{mod}</span>
                    <span className="hotkey-key">{key}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ResourceStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: '10px', color: 'var(--tx-3)', marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--tx-1)', fontFamily: 'var(--font-mono)' }}>{value}</div>
  </div>
);

/* ─── Tab Bar ────────────────────────────────────────────── */
const TabBar: React.FC = () => {
  const { tabs, activeTab, setActiveTab, closeTab, createFile } = useStore();
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.path}
          className={`tab-item ${activeTab === tab.path ? 'is-active' : ''}`}
          onClick={() => setActiveTab(tab.path)}
        >
          <FileText size={12} className="tab-icon" />
          <span className="tab-label">{tab.label}</span>
          <button
            className="tab-close"
            title="Close tab (⌘W)"
            onClick={e => { e.stopPropagation(); closeTab(tab.path); }}
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <button
        className="tab-new"
        title="New note (⌘N)"
        onClick={() => createFile('Untitled')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
};

/* ─── Icon Dock ──────────────────────────────────────────── */
const IconDock: React.FC<{ onSettings: () => void }> = ({ onSettings }) => {
  const { viewMode, setViewMode, isSidebarOpen, setSidebarOpen, isSplitView, toggleSplitView } = useStore();
  const { query } = useKBar();

  return (
    <div className="icon-sidebar">
      <div className="icon-dock-group">
        <button className={`icon-btn ${viewMode === 'editor' ? 'active' : ''}`} onClick={() => setViewMode('editor')} title="Editor">
          <FileText size={18} />
        </button>
        <button className={`icon-btn ${viewMode === 'canvas' ? 'active' : ''}`} onClick={() => setViewMode('canvas')} title="Canvas (⌘D)">
          <Palette size={18} />
        </button>
        <button className={`icon-btn ${viewMode === 'graph' ? 'active' : ''}`} onClick={() => setViewMode('graph')} title="Graph (⌘G)">
          <Share2 size={18} />
        </button>
        <button className={`icon-btn ${isSplitView ? 'active' : ''}`} onClick={() => { import('react-hot-toast').then(m => m.toast('Split View: ' + (!isSplitView ? 'ON' : 'OFF'))); toggleSplitView(); }} title="Toggle Split View">
          <PanelLeftOpen size={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button className={`icon-btn ${viewMode === 'journal' ? 'active' : ''}`} onClick={() => setViewMode('journal')} title="Journal (⌘J)">
          <CalendarDays size={18} />
        </button>
        <button className={`icon-btn ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')} title="Kanban (⌘M)">
          <Kanban size={18} />
        </button>
        <button className="icon-btn" onClick={() => query.toggle()} title="Search (⌘K)">
          <Search size={18} />
        </button>
        {useStore.getState().isAiEnabled && (
          <button className="icon-btn" onClick={() => document.dispatchEvent(new CustomEvent('toggle-chat'))} title="Vault Chat">
            <Bot size={18} />
          </button>
        )}
        <button className="icon-btn" onClick={() => setSidebarOpen(!isSidebarOpen)} title="Toggle Sidebar (⌘B)">
          {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>
      <div className="icon-dock-spacer" />
      <div className="icon-dock-group">
        <button className="icon-btn" onClick={onSettings} title="Settings">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};

/* ─── Welcome / Empty States ─────────────────────────────── */
const WelcomeScreen: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <div className="welcome-screen">
    <div className="welcome-logo">Nopes</div>
    <div className="welcome-subtitle">Local-first knowledge base. Your notes, your machine.</div>
    <button className="welcome-open-btn" onClick={onOpen}>Open Vault</button>
    <div className="welcome-shortcuts">
      <div className="welcome-shortcut"><span className="shortcut-key">⌘K</span> Search</div>
      <div className="welcome-shortcut"><span className="shortcut-key">⌘B</span> Sidebar</div>
      <div className="welcome-shortcut"><span className="shortcut-key">⌘G</span> Graph</div>
    </div>
  </div>
);

const EmptyState: React.FC = () => (
  <div className="empty-state">
    <FileText size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
    <div className="empty-state-title">No file open</div>
    <div className="empty-state-hint">Select a note from the sidebar or press <strong>⌘K</strong></div>
  </div>
);

/* ─── App Root ───────────────────────────────────────────── */
const App: React.FC = () => {
  const { 
    vaultPath, setVaultPath, activeTab, viewMode, isSidebarOpen, setSidebarOpen, 
    setViewMode, createFile, closeTab, loadGraphData, loadFiles, importFiles,
    isSplitView, rightActiveTab, rightViewMode
  } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Split View Resizer state
  const [leftWidth, setLeftWidth] = useState(50);
  const containerRef = useRef<HTMLElement>(null);
  const dragRef = useRef({ startX: 0, startWidth: 0 });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    dragRef.current = { startX: e.clientX, startWidth: leftWidth };
    const containerWidth = containerRef.current.getBoundingClientRect().width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - dragRef.current.startX;
      const deltaPercentage = (delta / containerWidth) * 100;
      let newWidth = dragRef.current.startWidth + deltaPercentage;
      if (newWidth < 20) newWidth = 20;
      if (newWidth > 80) newWidth = 80;
      setLeftWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
  }, [leftWidth]);

  // Restore vault and AI state from storage on mount
  useEffect(() => {
    if (vaultPath) {
      loadFiles();
      loadGraphData();
    }
    // Manage AI process based on setting
    const { isAiEnabled } = useStore.getState();
    import('@tauri-apps/api/core').then(m => {
      m.invoke('manage_ollama', { active: isAiEnabled }).catch(console.error);
    });
  }, [vaultPath, loadFiles, loadGraphData]);

  const handleOpenVault = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) setVaultPath(selected as string);
  }, [setVaultPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      switch (e.key) {
        case 'b': e.preventDefault(); setSidebarOpen(!isSidebarOpen); break;
        case 'e': e.preventDefault(); setViewMode('editor'); break;
        case 'd': e.preventDefault(); setViewMode('canvas'); break;
        case 'g': e.preventDefault(); setViewMode('graph'); break;
        case 'j': e.preventDefault(); setViewMode('journal'); break;
        case 'm': e.preventDefault(); setViewMode('kanban'); break;
        case 'n': e.preventDefault(); createFile('Untitled'); break;
        case 'w': e.preventDefault(); if (activeTab) closeTab(activeTab); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSidebarOpen, activeTab, setSidebarOpen, setViewMode, createFile, closeTab]);

  useEffect(() => {
    if (viewMode === 'graph') loadGraphData();
  }, [viewMode, loadGraphData]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const { paths } = event.payload;
        if (paths.length > 0) {
          importFiles(paths);
        }
      }
    });

    const onToggleChat = () => setChatOpen(o => !o);
    document.addEventListener('toggle-chat', onToggleChat);

    return () => {
      unlisten.then(fn => fn());
      document.removeEventListener('toggle-chat', onToggleChat);
    };
  }, [importFiles]);



  return (
    <ErrorBoundary>
      <CommandBar>
        <Toaster position="bottom-right" toastOptions={{ 
          style: { 
            background: 'var(--bg-2)', 
            color: 'var(--tx-1)', 
            borderRadius: '4px',
            border: '1px solid var(--bd-1)',
            fontSize: '0.85rem'
          } 
        }} />
        <div className="app-container">
          <IconDock onSettings={() => setSettingsOpen(true)} />
          {vaultPath && isSidebarOpen && <Sidebar />}
          <main className="main-content" ref={containerRef} style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            {!vaultPath ? (
              <WelcomeScreen onOpen={handleOpenVault} />
            ) : (
              <>
                {/* Left Pane */}
                <div style={{ flex: isSplitView ? `0 0 ${leftWidth}%` : 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  { viewMode === 'graph' ? <GraphView /> :
                    viewMode === 'journal' ? <JournalView /> :
                    viewMode === 'canvas' ? <CanvasView /> :
                    viewMode === 'kanban' ? <KanbanView /> :
                    (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <TabBar />
                        {activeTab ? <NoteEditor tabId={activeTab} /> : <EmptyState />}
                      </div>
                    )
                  }
                </div>

                {/* Resizer Handle */}
                {isSplitView && (
                  <div 
                    onMouseDown={onDragStart}
                    style={{ 
                      width: '4px', 
                      background: 'var(--bd-2)', 
                      cursor: 'col-resize',
                      zIndex: 50,
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bd-2)')}
                  />
                )}

                {/* Right Pane */}
                {isSplitView && (
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
                    { rightViewMode === 'graph' ? <GraphView /> :
                      rightViewMode === 'journal' ? <JournalView /> :
                      rightViewMode === 'canvas' ? <CanvasView /> :
                      rightViewMode === 'kanban' ? <KanbanView /> :
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {rightActiveTab ? <NoteEditor tabId={rightActiveTab} /> : <EmptyState />}
                      </div>
                    }
                  </div>
                )}
              </>
            )}
          </main>
          {vaultPath && chatOpen && <VaultChat onClose={() => setChatOpen(false)} />}
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </CommandBar>
    </ErrorBoundary>
  );
};

export default App;
