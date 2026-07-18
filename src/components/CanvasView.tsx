import { Palette } from "lucide-react";
import React, { useState, useEffect, useRef, Suspense } from 'react';
import '@excalidraw/excalidraw/index.css';
import { useStore } from '../store/useStore';
import { isDarkTheme, cssToken } from '../themes';
import { readTextFile, writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { X, RefreshCw } from 'lucide-react';

const ExcalidrawComp = React.lazy(() => import('@excalidraw/excalidraw').then(mod => ({ default: mod.Excalidraw })));

export const CanvasView: React.FC = () => {
  const { activeTab, vaultPath, setViewMode, allFiles, openFile, theme } = useStore();
  const excalidrawTheme = isDarkTheme(theme) ? 'dark' : 'light';
  const [initialData, setInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const excalidrawRef = useRef<any>(null);

  // Derive canvas file path from active note. Keyed by the note's
  // vault-relative path (slashes → '__') so same-named notes in
  // different folders don't share one canvas file.
  const getCanvasPath = async () => {
    if (!activeTab || !vaultPath) return null;
    const canvasDir = await join(vaultPath, 'canvas');
    if (!(await exists(canvasDir))) {
      await mkdir(canvasDir);
    }
    const rel = activeTab.replace(vaultPath, '').replace(/^[/\\]/, '');
    const key = rel.replace(/\.md$/, '').replace(/[/\\]/g, '__') || 'Untitled';
    const scopedPath = await join(canvasDir, `${key}.excalidraw`);
    // Migration: fall back to the old basename-keyed file if it exists
    if (!(await exists(scopedPath))) {
      const legacyName = activeTab.split(/[/\\]/).pop()?.replace(/\.md$/, '') || 'Untitled';
      const legacyPath = await join(canvasDir, `${legacyName}.excalidraw`);
      if (legacyName !== key && (await exists(legacyPath))) return legacyPath;
    }
    return scopedPath;
  };

  useEffect(() => {
    let active = true;
    hasDrawnRef.current = false;
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

  const hasDrawnRef = useRef(false);

  const handleSave = (elements: readonly any[], appState: any, files: any) => {
    // Skip the initial empty onChange, but once the user has drawn
    // something, persist empty states too — deleting every shape
    // must survive a reopen.
    if (!elements) return;
    if (elements.length === 0 && !hasDrawnRef.current) return;
    hasDrawnRef.current = true;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const path = await getCanvasPath();
        if (!path) return;
        const payload = JSON.stringify({ elements, appState: { theme: excalidrawTheme, viewBackgroundColor: appState.viewBackgroundColor }, files });
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
              <RefreshCw className="spinning" size={24} />
            </div>
          ) : (
            <Suspense fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
                Loading Excalidraw...
              </div>
            }>
              <ExcalidrawComp
                excalidrawAPI={(api) => { excalidrawRef.current = api; }}
                theme={excalidrawTheme}
                initialData={initialData || { appState: { theme: excalidrawTheme, viewBackgroundColor: cssToken('--bg-0') || '#0a0a0a' } }}
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
