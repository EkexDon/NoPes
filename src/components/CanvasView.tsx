import { Palette } from "lucide-react";
import React, { useState, useEffect, useRef, Suspense } from 'react';
import '@excalidraw/excalidraw/index.css';
import { useStore } from '../store/useStore';
import { readTextFile, writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { X, Save, RefreshCw } from 'lucide-react';

const ExcalidrawComp = React.lazy(() => import('@excalidraw/excalidraw').then(mod => ({ default: mod.Excalidraw })));

export const CanvasView: React.FC = () => {
  const { activeTab, vaultPath, setViewMode, allFiles, openFile } = useStore();
  const [initialData, setInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const excalidrawRef = useRef<any>(null);

  // Derive canvas file path from active note
  const getCanvasPath = async () => {
    if (!activeTab || !vaultPath) return null;
    const canvasDir = await join(vaultPath, 'canvas');
    if (!(await exists(canvasDir))) {
      await mkdir(canvasDir);
    }
    const noteName = activeTab.split('/').pop()?.replace('.md', '') || 'Untitled';
    return await join(canvasDir, `${noteName}.excalidraw`);
  };

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      const path = await getCanvasPath();
      if (!path) {
        if (active) setLoading(false);
        return;
      }
      try {
        if (await exists(path)) {
          const raw = await readTextFile(path);
          const data = JSON.parse(raw);
          if (active) setInitialData(data);
        } else {
          if (active) setInitialData(null);
        }
      } catch (err) {
        console.error('Failed to load canvas data:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadData();
    return () => { active = false; };
  }, [activeTab, vaultPath]);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSave = (elements: readonly any[], appState: any, files: any) => {
    if (!elements || elements.length === 0) return;
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const path = await getCanvasPath();
        if (!path) return;
        const payload = JSON.stringify({ elements, appState: { theme: 'dark', viewBackgroundColor: appState.viewBackgroundColor }, files });
        await writeFile(path, new TextEncoder().encode(payload));
      } catch (err) {
        console.error('Failed to save canvas:', err);
      } finally {
        setSaving(false);
      }
    }, 1000); // 1s debounce
  };

  const closeCanvas = () => {
    setViewMode('editor');
  };

  if (!activeTab) return null;

  return (
    <div className="canvas-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--bg-primary)' }}>
      <div className="editor-topbar" style={{ flexShrink: 0 }}>
        <div className="editor-topbar-left">
          <Palette size={14} />
          <span className="editor-topbar-breadcrumb">{activeTab.split('/').pop()?.replace('.md', '')} (Canvas)</span>
        </div>
        <div className="editor-topbar-right">
          <span className={`save-status ${saving ? 'saving' : ''}`}>{saving ? 'Saving...' : 'Ready'}</span>
          <button className="icon-btn sm" onClick={closeCanvas} title="Close Canvas">
            <X size={15} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
              <RefreshCw className="spin" size={24} />
            </div>
          ) : (
            <Suspense fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
                Loading Excalidraw...
              </div>
            }>
              <ExcalidrawComp
                excalidrawAPI={(api) => { excalidrawRef.current = api; }}
                theme="dark"
                initialData={initialData || { appState: { theme: 'dark', viewBackgroundColor: '#0a0a0a' } }}
                onChange={handleSave}
                onLinkOpen={(element, event) => {
                  let link = element.link || '';
                  if (!link) return;
                  if (link.startsWith('[[') && link.endsWith(']]')) {
                    link = link.slice(2, -2);
                  }
                  const targetName = link.toLowerCase().replace(/\.md$/, '');
                  const foundFile = allFiles.find(f => f.name.toLowerCase().replace(/\.md$/, '') === targetName);
                  
                  if (foundFile) {
                    event.preventDefault();
                    openFile(foundFile.path).then(() => setViewMode('editor'));
                  }
                }}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
};
