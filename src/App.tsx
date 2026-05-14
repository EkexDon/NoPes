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
  Shield, Palette, Keyboard, CalendarDays, Bot, Kanban,
  Home, ChevronRight, Folder, LayoutGrid
} from 'lucide-react';
import { useKBar } from 'kbar';
import { Toaster } from 'react-hot-toast';
import { VaultChat } from './components/VaultChat';
import { CanvasView } from './components/CanvasView';
import { KanbanView } from './components/KanbanView';
import { HomeView } from './components/HomeView';

/* ─── Error Boundary ─────────────────────────────────────── */
const MAX_AUTO_RETRIES = 2;
class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  {hasError: boolean, error: Error | null, retryCount: number, crashTime: string | null}
> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null, retryCount: 0, crashTime: null }; }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, crashTime: new Date().toISOString() };
  }
  componentDidCatch(error: Error, errorInfo: any) {
    console.error(`[NoPes:ErrorBoundary] Crash #${this.state.retryCount + 1} at ${new Date().toISOString()}`, error, errorInfo);
    // Auto-retry on first crash (transient Strict-Mode race conditions, etc.)
    if (this.state.retryCount < MAX_AUTO_RETRIES) {
      const delay = 1500 * (this.state.retryCount + 1); // exponential-ish backoff
      console.warn(`[NoPes:ErrorBoundary] Auto-retry in ${delay}ms...`);
      setTimeout(() => {
        this.setState(prev => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }));
      }, delay);
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', background: 'var(--bg-0, #1a1a2e)', color: 'var(--tx-1, #e8e8e8)', height: '100vh', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ margin: 0 }}>Whoops — NoPes ran into a problem</h2>
          <div style={{ fontSize: '13px', color: 'var(--tx-3, #888)' }}>
            {this.state.retryCount < MAX_AUTO_RETRIES
              ? `Auto-recovering (attempt ${this.state.retryCount + 1}/${MAX_AUTO_RETRIES})…`
              : `Recovery failed after ${MAX_AUTO_RETRIES} attempts. The error is shown below.`
            }
          </div>
          <pre style={{ background: 'rgba(180,30,30,0.15)', padding: '16px', borderRadius: '8px', overflow: 'auto', fontSize: '12px', lineHeight: '1.6', border: '1px solid rgba(255,60,60,0.2)', maxHeight: '40vh' }}>
            <strong>Time:</strong> {this.state.crashTime}{'\n'}
            <strong>Attempt:</strong> {this.state.retryCount}/{MAX_AUTO_RETRIES}{'\n\n'}
            {this.state.error?.stack || this.state.error?.message}
          </pre>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => this.setState({ hasError: false, error: null })} style={{ padding: '8px 20px', borderRadius: '6px', background: 'var(--accent, #7c6dff)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer' }}>Try Again</button>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', borderRadius: '6px', background: 'var(--bg-3, #333)', color: 'var(--tx-1, #e8e8e8)', fontWeight: 600, border: '1px solid var(--bd-1, #444)', cursor: 'pointer' }}>Hard Reload</button>
          </div>
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
  const [stats, setStats] = useState({ app: '—', webview: '—', ollama: '—' });

  const formatMb = (mb: number) => (
    mb > 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB'
  );

  useEffect(() => {
    const fetch = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res: any = await invoke('get_system_stats');
        setStats({ 
          app: formatMb(res.app_mb ?? 0),
          webview: formatMb(res.webview_mb ?? 0),
          ollama: formatMb(res.ollama_mb ?? 0)
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <ResourceStat label="App Process" value={stats.app} />
                  <ResourceStat label="Nopes WebView" value={stats.webview} />
                  <ResourceStat label="Ollama Service" value={stats.ollama} />
                </div>
                <div style={{ fontSize: '11px', color: 'var(--tx-3)', marginTop: '12px', fontStyle: 'italic' }}>
                  * WebView stat is scoped to Nopes-owned WebKit cache users.
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
        <button className={`icon-btn ${viewMode === 'home' ? 'active' : ''}`} onClick={() => setViewMode('home')} title="Home (⌘H)">
          <Home size={18} />
        </button>
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

/* ─── Breadcrumb Navigation ────────────────────────────── */
const Breadcrumb: React.FC<{ 
  vaultPath: string | null; 
  activeTab: string | null;
  viewMode: string;
  onNavigate: (path: 'home' | 'vault') => void;
}> = ({ vaultPath, activeTab, viewMode, onNavigate }) => {
  if (!vaultPath) return null;
  
  const vaultName = vaultPath.split(/[\\/]/).pop() || 'Vault';
  
  // Build path segments from activeTab
  const getPathSegments = () => {
    if (!activeTab) return [];
    const relativePath = activeTab.replace(vaultPath, '').replace(/^[/\\]/, '');
    if (!relativePath) return [];
    return relativePath.split(/[\\/]/);
  };
  
  const segments = getPathSegments();
  
  return (
    <div className="breadcrumb-bar">
      <button 
        className={`breadcrumb-item ${viewMode === 'home' ? 'active' : ''}`}
        onClick={() => onNavigate('home')}
      >
        <Home size={14} />
        <span>Home</span>
      </button>
      
      <ChevronRight size={14} className="breadcrumb-separator" />
      
      <button 
        className={`breadcrumb-item ${viewMode !== 'home' && !activeTab ? 'active' : ''}`}
        onClick={() => onNavigate('vault')}
      >
        <Folder size={14} />
        <span>{vaultName}</span>
      </button>
      
      {segments.length > 0 && segments.map((segment, idx) => (
        <React.Fragment key={idx}>
          <ChevronRight size={14} className="breadcrumb-separator" />
          <span className={`breadcrumb-item ${idx === segments.length - 1 ? 'active' : ''}`}>
            {idx === segments.length - 1 && viewMode !== 'editor' && (
              <>
                {viewMode === 'canvas' && <LayoutGrid size={14} />}
                {viewMode === 'kanban' && <Kanban size={14} />}
                {viewMode === 'graph' && <Share2 size={14} />}
                {viewMode === 'journal' && <CalendarDays size={14} />}
                {viewMode === 'editor' && <FileText size={14} />}
              </>
            )}
            {idx === segments.length - 1 ? (
              <span>{segment.replace(/\.md$/, '')}</span>
            ) : (
              <span>{segment}</span>
            )}
          </span>
        </React.Fragment>
      ))}
      
      {activeTab && segments.length === 0 && (
        <>
          <ChevronRight size={14} className="breadcrumb-separator" />
          <span className="breadcrumb-item active">
            <FileText size={14} />
            <span>{activeTab.split(/[\\/]/).pop()?.replace(/\.md$/, '')}</span>
          </span>
        </>
      )}
    </div>
  );
};

/* ─── App Root ───────────────────────────────────────────── */
const App: React.FC = () => {
  const { 
    vaultPath, setVaultPath, activeTab, viewMode, isSidebarOpen, setSidebarOpen, 
    setViewMode, createFile, closeTab, loadGraphData, loadFiles, importFiles,
    isSplitView, rightActiveTab, rightViewMode, zenMode, setZenMode
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
      // Set default view to Home when vault opens
      setViewMode('home');
    }
    // Manage AI process based on setting
    const { isAiEnabled } = useStore.getState();
    import('@tauri-apps/api/core').then(m => {
      m.invoke('manage_ollama', { active: isAiEnabled }).catch(console.error);
    });
  }, [vaultPath, loadFiles, loadGraphData, setViewMode]);

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
        case 'h': e.preventDefault(); setViewMode('home'); break;
        case 'n': e.preventDefault(); createFile('Untitled'); break;
        case 'w': e.preventDefault(); if (activeTab) closeTab(activeTab); break;
        case 'z': if (e.shiftKey) { e.preventDefault(); setZenMode(!zenMode); } break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSidebarOpen, activeTab, setSidebarOpen, setViewMode, createFile, closeTab, zenMode, setZenMode]);

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
        <div className={`app-container ${zenMode ? 'zen-mode-active' : ''}`}>
          <IconDock onSettings={() => setSettingsOpen(true)} />
          {vaultPath && isSidebarOpen && <Sidebar />}
          <main className="main-content" ref={containerRef} style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            {!vaultPath ? (
              <WelcomeScreen onOpen={handleOpenVault} />
            ) : (
              <>
                {/* Left Pane */}
                <div style={{ flex: isSplitView ? `0 0 ${leftWidth}%` : 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {/* Breadcrumb Navigation */}
                  <Breadcrumb 
                    vaultPath={vaultPath}
                    activeTab={activeTab}
                    viewMode={viewMode}
                    onNavigate={(target) => {
                      if (target === 'home') setViewMode('home');
                      else setViewMode('editor');
                    }}
                  />
                  
                  { viewMode === 'graph' ? <GraphView /> :
                    viewMode === 'journal' ? <JournalView /> :
                    viewMode === 'canvas' ? <CanvasView /> :
                    viewMode === 'kanban' ? <KanbanView /> :
                    viewMode === 'home' ? <HomeView /> :
                    (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <TabBar />
                        {activeTab ? <NoteEditor key={activeTab} tabId={activeTab} /> : <EmptyState />}
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
                        {rightActiveTab ? <NoteEditor key={rightActiveTab} tabId={rightActiveTab} /> : <EmptyState />}
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
