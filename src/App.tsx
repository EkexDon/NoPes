import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { NoteEditor } from './components/NoteEditor';
import { GraphView } from './components/GraphView';
import { CommandBar } from './components/CommandBar';
import { useStore } from './store/useStore';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  FileText, Share2, Search, Settings,
  PanelLeftClose, PanelLeftOpen, Plus, X,
  Shield, Palette, Keyboard,
} from 'lucide-react';
import { useKBar } from 'kbar';
import { Toaster } from 'react-hot-toast';

/* ─── Settings Modal ─────────────────────────────────────── */
type SettingsTab = 'general' | 'appearance' | 'hotkeys';

const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { vaultPath } = useStore();
  const [tab, setTab] = useState<SettingsTab>('general');

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
                <span className="setting-value">Enabled</span>
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
  const { viewMode, setViewMode, isSidebarOpen, setSidebarOpen } = useStore();
  const { query } = useKBar();

  return (
    <div className="icon-sidebar">
      <div className="icon-dock-group">
        <button className={`icon-btn ${viewMode === 'editor' ? 'active' : ''}`} onClick={() => setViewMode('editor')} title="Editor">
          <FileText size={18} />
        </button>
        <button className={`icon-btn ${viewMode === 'graph' ? 'active' : ''}`} onClick={() => setViewMode('graph')} title="Graph (⌘G)">
          <Share2 size={18} />
        </button>
        <button className="icon-btn" onClick={() => query.toggle()} title="Search (⌘K)">
          <Search size={18} />
        </button>
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
  const { vaultPath, setVaultPath, activeTab, viewMode, isSidebarOpen, setSidebarOpen, setViewMode, createFile, closeTab, loadGraphData, loadFiles, importFiles } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Restore vault from storage on mount
  useEffect(() => {
    if (vaultPath) {
      loadFiles();
      loadGraphData();
    }
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
        case 'g': e.preventDefault(); setViewMode('graph'); break;
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

    return () => {
      unlisten.then(fn => fn());
    };
  }, [importFiles]);

  const showGraph  = vaultPath && viewMode === 'graph';

  return (
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
        <main className="main-content">
          {!vaultPath ? (
            <WelcomeScreen onOpen={handleOpenVault} />
          ) : showGraph ? (
            <GraphView />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
              <TabBar />
              {activeTab ? <NoteEditor /> : <EmptyState />}
            </div>
          )}
        </main>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </CommandBar>
  );
};

export default App;
