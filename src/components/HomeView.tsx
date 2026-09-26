import React, { useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  ChevronRight, Copy, ExternalLink, FileText, Folder, FolderPlus, Grid3X3,
  Heart, Kanban, Layout, List, Palette, Plus, Search,
  Tag, Trash2, Upload, X
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useStore, FileInfo, FileMetadata } from '../store/useStore';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { canMoveInto, isDirectChild, parentPath } from '../fileOrganization';

type HomeItem = { path: string; name: string; is_dir: boolean; modifiedAt?: number };
const pathName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const POSITIONS_KEY = 'nopes_home_positions';
type Grouping = 'none' | 'date';
type DateFilter = 'all' | 'today' | '7days' | '30days';

function flattenTree(entries: FileInfo[]): FileInfo[] {
  return entries.flatMap(entry => [entry, ...(entry.children ? flattenTree(entry.children) : [])]);
}

function bytesToDataUrl(bytes: Uint8Array, name: string) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const ext = name.split('.').pop()?.toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${btoa(binary)}`;
}

const FolderArtwork: React.FC<{
  metadata?: FileMetadata;
}> = ({ metadata }) => {
  if (metadata?.iconType === 'image' && metadata.icon) {
    return <img className="finder-folder-art" src={metadata.icon} alt="" />;
  }
  if (metadata?.iconType === 'emoji' && metadata.icon === '📁') {
    return <Folder size={54} fill="currentColor" strokeWidth={1.4} />;
  }
  if (metadata?.iconType === 'emoji' && metadata.icon) {
    return <span className="finder-folder-emoji">{metadata.icon}</span>;
  }
  if (metadata?.iconType === 'lucide' && metadata.icon === 'Folder') {
    return <Folder size={54} fill="currentColor" strokeWidth={1.4} />;
  }
  return <Folder size={54} fill="currentColor" strokeWidth={1.4} />;
};

const DrawingModal: React.FC<{
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}> = ({ onSave, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#2367d1';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (e.currentTarget.width / rect.width),
      y: (e.clientY - rect.top) * (e.currentTarget.height / rect.height)
    };
  };
  return (
    <div className="finder-modal-overlay" onClick={onClose}>
      <div className="finder-art-modal" onClick={e => e.stopPropagation()}>
        <div className="finder-modal-header"><strong>Draw folder icon</strong><button onClick={onClose}><X size={18} /></button></div>
        <canvas
          ref={canvasRef}
          width={420}
          height={280}
          className="finder-drawing-canvas"
          onPointerDown={e => {
            const ctx = e.currentTarget.getContext('2d');
            if (!ctx) return;
            drawing.current = true;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext('2d');
            if (!ctx) return;
            const p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }}
          onPointerUp={() => { drawing.current = false; }}
          onPointerCancel={() => { drawing.current = false; }}
        />
        <div className="finder-modal-actions">
          <button className="btn secondary" onClick={() => {
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx && canvasRef.current) {
              ctx.fillStyle = '#f7f7f7';
              ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
          }}>Clear</button>
          <button className="btn" onClick={() => canvasRef.current && onSave(canvasRef.current.toDataURL('image/png'))}>Use drawing</button>
        </div>
      </div>
    </div>
  );
};

const HomeCard: React.FC<{
  item: HomeItem;
  metadata?: FileMetadata;
  selected: boolean;
  onOpen: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}> = ({ item, metadata, selected, onOpen, onSelect, onContextMenu, onDragStart, onDragOver, onDrop }) => {
  const type = metadata?.itemType === 'canvas' ? 'Canvas' : metadata?.itemType === 'kanban' ? 'Kanban' : item.is_dir ? 'Folder' : 'Note';
  return (
    <div
      className={`finder-card ${selected ? 'is-selected' : ''}`}
      draggable
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={item.is_dir ? onDragOver : undefined}
      onDrop={item.is_dir ? onDrop : undefined}
      title={item.is_dir ? 'Double-click to open folder' : 'Double-click to open note'}
    >
      <div className="finder-card-art">
        {item.is_dir ? <FolderArtwork metadata={metadata} /> :
          metadata?.iconType === 'image' && metadata.icon ? <img className="finder-folder-art" src={metadata.icon} alt="" /> :
          metadata?.icon ? <span className="finder-folder-emoji">{metadata.icon}</span> :
          metadata?.itemType === 'canvas' ? <Layout size={50} /> :
          metadata?.itemType === 'kanban' ? <Kanban size={50} /> : <FileText size={50} />}
      </div>
      <div className="finder-card-name">{item.name.replace(/\.md$/, '')}</div>
      <div className="finder-card-type">{type}</div>
      {metadata?.lastModified && <span className="finder-card-dot" />}
    </div>
  );
};

const HomeView: React.FC = () => {
  const {
    files, vaultPath, fileMetadata, favorites, openFile, createFile,
    createFolder, createCanvasFile, createKanbanFile, toggleFavorite, deleteItem,
    revealInFinder, copyToClipboard, duplicateFile, moveItem, setFileIcon, tagItems
  } = useStore();
  const { menu, showMenu, hideMenu } = useContextMenu();
  const [currentFolder, setCurrentFolder] = useState(vaultPath ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'icons' | 'list'>('icons');
  const [grouping, setGrouping] = useState<Grouping>('none');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [positions, setPositions] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}'); } catch { return {}; }
  });
  const draggingPath = useRef<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showTag, setShowTag] = useState(false);
  const [showArtwork, setShowArtwork] = useState<string | null>(null);
  const [drawingFolder, setDrawingFolder] = useState<string | null>(null);
  const [showDrawing, setShowDrawing] = useState(false);
  const [namePrompt, setNamePrompt] = useState<'folder' | 'note' | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [tagValue, setTagValue] = useState('');

  useEffect(() => {
    if (vaultPath && (!currentFolder || !currentFolder.startsWith(vaultPath))) setCurrentFolder(vaultPath);
  }, [vaultPath, currentFolder]);

  const allEntries = useMemo(() => flattenTree(files), [files]);
  const items = useMemo(() => {
    const direct = allEntries
      .filter(item => isDirectChild(item.path, currentFolder))
      .filter(item => item.is_dir || item.name.toLowerCase().endsWith('.md'))
      .map(item => ({ path: item.path, name: item.name, is_dir: item.is_dir, modifiedAt: item.modifiedAt }));
    const ordered = [...direct].sort((a, b) => {
      const order = positions[currentFolder] ?? [];
      const ai = order.indexOf(a.path), bi = order.indexOf(b.path);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      return a.name.localeCompare(b.name);
    });
    const now = Date.now();
    const cutoff = dateFilter === 'today' ? new Date().setHours(0, 0, 0, 0)
      : dateFilter === '7days' ? now - 7 * 86400000
      : dateFilter === '30days' ? now - 30 * 86400000 : 0;
    const filtered = ordered.filter(item => !cutoff || (item.modifiedAt ?? 0) >= cutoff);
    if (!search.trim()) return filtered;
    const query = search.toLowerCase();
    return filtered.filter(item => item.name.toLowerCase().includes(query));
  }, [allEntries, currentFolder, search, positions, dateFilter]);
  const folders = useMemo(() => allEntries.filter(item => item.is_dir), [allEntries]);
  const breadcrumbs = useMemo(() => {
    if (!vaultPath || !currentFolder) return [];
    const relative = currentFolder.slice(vaultPath.length).replace(/^[/\\]/, '');
    const parts = relative ? relative.split(/[\\/]/) : [];
    return parts.map((label, index) => {
      const path = [vaultPath, ...parts.slice(0, index + 1)].join('/');
      return { label, path };
    });
  }, [vaultPath, currentFolder]);

  const selectItem = (item: HomeItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const additive = e.metaKey || e.ctrlKey;
    setSelected(prev => {
      const next = new Set(additive ? prev : []);
      if (additive && prev.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  };
  const selectedPaths = [...selected];
  const openItem = async (item: HomeItem) => {
    if (item.is_dir) {
      setCurrentFolder(item.path);
      setSelected(new Set());
    } else {
      await openFile(item.path);
    }
  };
  const moveSelected = async (target: string) => {
    const paths = selectedPaths.filter(path => canMoveInto(path, target) && parentPath(path) !== target);
    for (const path of paths) await moveItem(path, target);
    setSelected(new Set());
    setShowMove(false);
  };
  const createNamed = async () => {
    const name = nameValue.trim();
    if (!name || !namePrompt) return;
    if (namePrompt === 'folder') await createFolder(name, currentFolder);
    else await createFile(name, currentFolder);
    setNamePrompt(null);
    setNameValue('');
    setShowNew(false);
  };
  const setArtworkFromImage = async (path: string) => {
    try {
      const bytes = await readFile(path);
      setFileIcon(showArtwork!, bytesToDataUrl(bytes, pathName(path)), 'image');
      setShowArtwork(null);
    } catch (e) {
      console.error('Folder artwork import failed:', e);
      toast.error('Could not use that image');
    }
  };
  const buildMenu = (item?: HomeItem): ContextMenuItem[] => {
    const paths = item && !selected.has(item.path) ? [item.path] : selectedPaths;
    const hasFolder = paths.some(path => allEntries.find(entry => entry.path === path)?.is_dir);
    const first = item ?? items.find(i => selected.has(i.path));
    if (!first) return [];
    return [
      { id: 'open', label: first.is_dir ? 'Open Folder' : 'Open', icon: first.is_dir ? <Folder size={16} /> : <FileText size={16} />, action: () => openItem(first) },
      { id: 'move', label: `Move ${paths.length > 1 ? `${paths.length} Items` : 'to Folder'}…`, icon: <FolderPlus size={16} />, action: () => setShowMove(true) },
      { id: 'tag', label: 'Add Tag…', icon: <Tag size={16} />, disabled: hasFolder, action: () => setShowTag(true) },
      { id: 'divider-a', label: '', divider: true, action: () => {} },
      ...(first.is_dir ? [{ id: 'art', label: 'Customize Folder Artwork…', icon: <Palette size={16} />, action: () => setShowArtwork(first.path) }] : []),
      ...(first.is_dir ? [] : [{ id: 'favorite', label: paths.length > 1 ? 'Toggle Favorites' : favorites.includes(first.path) ? 'Remove from Favorites' : 'Add to Favorites', icon: <Heart size={16} />, action: () => paths.forEach(path => toggleFavorite(path)) }]),
      { id: 'duplicate', label: 'Duplicate', icon: <Copy size={16} />, disabled: hasFolder, action: () => paths.forEach(path => duplicateFile(path)) },
      { id: 'reveal', label: 'Reveal in Finder', icon: <ExternalLink size={16} />, action: () => revealInFinder(first.path) },
      { id: 'copy', label: 'Copy Path', icon: <Copy size={16} />, action: () => copyToClipboard(first.path) },
      { id: 'divider-b', label: '', divider: true, action: () => {} },
      { id: 'delete', label: `Move to Trash${paths.length > 1 ? ` (${paths.length})` : ''}`, icon: <Trash2 size={16} />, action: async () => { for (const path of paths) await deleteItem(path); setSelected(new Set()); } }
    ];
  };
  const onCardContext = (item: HomeItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(item.path)) setSelected(new Set([item.path]));
    showMenu(buildMenu(item), e);
  };
  const onDragStart = (item: HomeItem, e: React.DragEvent) => {
    const paths = selected.has(item.path) ? selectedPaths : [item.path];
    if (!selected.has(item.path)) setSelected(new Set(paths));
    e.dataTransfer.setData('application/x-nopes-paths', JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'move';
    draggingPath.current = item.path;
  };
  const reorderItem = (target: HomeItem) => {
    const source = draggingPath.current;
    if (!source || source === target.path || parentPath(source) !== currentFolder) return;
    const current = [...(positions[currentFolder] ?? items.map(item => item.path))].filter(path => items.some(item => item.path === path));
    const from = current.indexOf(source), to = current.indexOf(target.path);
    if (from < 0 || to < 0) return;
    current.splice(from, 1);
    current.splice(to, 0, source);
    const next = { ...positions, [currentFolder]: current };
    setPositions(next);
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(next));
    draggingPath.current = null;
  };
  const onDropFolder = async (target: HomeItem, e: React.DragEvent) => {
    if (!target.is_dir) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-nopes-paths');
    const paths: string[] = raw ? JSON.parse(raw) : selectedPaths;
    for (const path of paths) if (canMoveInto(path, target.path)) await moveItem(path, target.path);
    setSelected(new Set());
  };
  const submitTag = async () => {
    await tagItems(selectedPaths, tagValue);
    setShowTag(false);
    setTagValue('');
  };

  return (
    <div className="home-view finder-home" onClick={() => { setSelected(new Set()); setShowNew(false); }}>
      <div className="finder-toolbar" onClick={e => e.stopPropagation()}>
        <div className="finder-toolbar-title"><h1>Home</h1><span>{items.length} items</span></div>
        <div className="finder-toolbar-actions">
          {selected.size > 0 && <span className="finder-selection-count">{selected.size} selected</span>}
          <div className="home-search"><Search size={16} /><input placeholder="Search this folder" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <button className="finder-toolbar-button" onClick={() => setView(view === 'icons' ? 'list' : 'icons')} title="Change view">{view === 'icons' ? <List size={16} /> : <Grid3X3 size={16} />}</button>
          <select className="finder-select" value={grouping} onChange={e => setGrouping(e.target.value as Grouping)} aria-label="Grouping">
            <option value="none">Arrange: None</option><option value="date">Group by Date</option>
          </select>
          <select className="finder-select" value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)} aria-label="Date filter">
            <option value="all">All dates</option><option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option>
          </select>
          <div className="home-new-wrapper">
            <button className="home-new-btn" onClick={() => setShowNew(!showNew)}><Plus size={16} /> New</button>
            {showNew && <div className="home-new-menu finder-new-menu">
              <button onClick={() => { setNamePrompt('folder'); setShowNew(false); }}><FolderPlus size={16} /> New Folder</button>
              <button onClick={() => { setNamePrompt('note'); setShowNew(false); }}><FileText size={16} /> New Note</button>
              <button onClick={() => { createCanvasFile('Untitled Canvas', currentFolder); setShowNew(false); }}><Layout size={16} /> New Canvas</button>
              <button onClick={() => { createKanbanFile('Untitled Kanban', currentFolder); setShowNew(false); }}><Kanban size={16} /> New Kanban</button>
            </div>}
          </div>
        </div>
      </div>
      <div className="finder-breadcrumbs" onClick={e => e.stopPropagation()}>
        <button className={currentFolder === vaultPath ? 'active' : ''} onClick={() => setCurrentFolder(vaultPath ?? '')}>Vault</button>
        {breadcrumbs.map(crumb => <React.Fragment key={crumb.path}><ChevronRight size={14} /><button className={currentFolder === crumb.path ? 'active' : ''} onClick={() => setCurrentFolder(crumb.path)}>{crumb.label}</button></React.Fragment>)}
      </div>
      <div className="finder-content" onContextMenu={e => { e.preventDefault(); showMenu([{ id: 'new-folder', label: 'New Folder', icon: <FolderPlus size={16} />, action: () => setNamePrompt('folder') }], e); }}>
        <div className={`finder-grid ${view === 'list' ? 'list-view' : ''}`}>
          {(grouping === 'date' ? [...new Set(items.map(item => {
            const date = item.modifiedAt ? new Date(item.modifiedAt) : new Date(0);
            return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
          }))] : [null]).map(group => {
            const groupItems = group ? items.filter(item => {
              const date = item.modifiedAt ? new Date(item.modifiedAt) : new Date(0);
              return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) === group;
            }) : items;
            return (
              <React.Fragment key={group ?? 'all'}>
                {group && <div className="finder-date-heading">{group}</div>}
                {groupItems.map(item => (
                  <HomeCard
                    key={item.path}
                    item={item}
                    metadata={fileMetadata[item.path]}
                    selected={selected.has(item.path)}
                    onOpen={() => openItem(item)}
                    onSelect={e => selectItem(item, e)}
                    onContextMenu={e => onCardContext(item, e)}
                    onDragStart={e => onDragStart(item, e)}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('is-drag-over'); }}
                    onDrop={e => { e.currentTarget.classList.remove('is-drag-over'); if (item.is_dir) onDropFolder(item, e); else reorderItem(item); }}
                  />
                ))}
              </React.Fragment>
            );
          })}
        </div>
        {items.length === 0 && <div className="finder-empty"><Folder size={42} /><strong>This folder is empty</strong><span>Create a note or folder to get started.</span></div>}
      </div>

      {menu && <ContextMenu items={menu.items} position={menu.position} onClose={hideMenu} />}
      {namePrompt && <div className="finder-modal-overlay" onClick={() => setNamePrompt(null)}><form className="finder-small-modal" onSubmit={e => { e.preventDefault(); createNamed(); }} onClick={e => e.stopPropagation()}><h3>{namePrompt === 'folder' ? 'New Folder' : 'New Note'}</h3><input autoFocus value={nameValue} onChange={e => setNameValue(e.target.value)} placeholder={namePrompt === 'folder' ? 'Folder name' : 'Note name'} /><div className="finder-modal-actions"><button type="button" className="btn secondary" onClick={() => setNamePrompt(null)}>Cancel</button><button className="btn">Create</button></div></form></div>}
      {showMove && <div className="finder-modal-overlay" onClick={() => setShowMove(false)}><div className="finder-small-modal" onClick={e => e.stopPropagation()}><h3>Move {selectedPaths.length} {selectedPaths.length === 1 ? 'item' : 'items'} to…</h3><div className="finder-folder-list">{folders.filter(folder => !selected.has(folder.path) && !selectedPaths.some(path => folder.path.startsWith(`${path}/`))).map(folder => <button key={folder.path} onClick={() => moveSelected(folder.path)}><Folder size={18} />{folder.path.replace(`${vaultPath}/`, '')}</button>)}</div><div className="finder-modal-actions"><button className="btn secondary" onClick={() => setShowMove(false)}>Cancel</button></div></div></div>}
      {showTag && <div className="finder-modal-overlay" onClick={() => setShowTag(false)}><form className="finder-small-modal" onSubmit={e => { e.preventDefault(); submitTag(); }} onClick={e => e.stopPropagation()}><h3>Tag selected notes</h3><input autoFocus value={tagValue} onChange={e => setTagValue(e.target.value)} placeholder="e.g. project or #project" /><div className="finder-modal-actions"><button type="button" className="btn secondary" onClick={() => setShowTag(false)}>Cancel</button><button className="btn"><Tag size={15} /> Add tag</button></div></form></div>}
      {showArtwork && <div className="finder-modal-overlay" onClick={() => setShowArtwork(null)}><div className="finder-art-modal" onClick={e => e.stopPropagation()}><div className="finder-modal-header"><strong>Customize folder artwork</strong><button onClick={() => setShowArtwork(null)}><X size={18} /></button></div><div className="finder-art-options"><button onClick={() => { setFileIcon(showArtwork, 'Folder', 'lucide'); setShowArtwork(null); }}><Folder size={32} fill="currentColor" strokeWidth={1.4} /> Default</button><button onClick={async () => { const chosen = await openDialog({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (typeof chosen === 'string') await setArtworkFromImage(chosen); }}><Upload size={24} /> Picture</button><button onClick={() => { setDrawingFolder(showArtwork); setShowArtwork(null); setShowDrawing(true); }}><Palette size={24} /> Draw</button></div></div></div>}
      {showDrawing && <DrawingModal onClose={() => { setShowDrawing(false); setDrawingFolder(null); }} onSave={data => { if (drawingFolder) setFileIcon(drawingFolder, data, 'image'); setShowDrawing(false); setDrawingFolder(null); }} />}
    </div>
  );
};

export { HomeView };
