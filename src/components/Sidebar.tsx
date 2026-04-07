import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';
import {
  FileText, FolderOpen, ChevronRight, ChevronDown,
  Plus, FolderPlus, Star, X, RotateCw, Edit3, Trash2
} from 'lucide-react';
import { openPath as openExternal } from '@tauri-apps/plugin-opener';
import { motion, AnimatePresence } from 'framer-motion';
import { GraphView } from './GraphView';

/* ─── Types ──────────────────────────────────────────────── */
interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileInfo[];
  isFavorite?: boolean;
}

/* ─── Single Row ─────────────────────────────────────────── */
const FileRow: React.FC<{ file: FileInfo; depth: number }> = ({ file, depth }) => {
  const { openFile, activeTab, toggleFavorite, renameItem, deleteItem } = useStore();
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(file.name.replace(/\.md$/, ''));
  const isActive = activeTab === file.path;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditing) return;
    if (file.is_dir) {
      setOpen(o => !o);
    } else {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.md')) {
        const tid = toast.loading(`Opening ${file.name}…`);
        try {
          await openExternal(file.path);
          toast.success(`Opened ${file.name}`, { id: tid });
        } catch (err: any) {
          console.error('openPath failed:', err);
          toast.error(`Could not open: ${err?.message ?? err}`, { id: tid, duration: 8000 });
        }
      } else {
        openFile(file.path);
      }
    }
  };

  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!file.is_dir) toggleFavorite(file.path);
  };

  const handleRename = async () => {
    if (editValue.trim() && editValue !== file.name.replace(/\.md$/, '')) {
       await renameItem(file.path, editValue.trim());
    } else {
       setEditValue(file.name.replace(/\.md$/, ''));
    }
    setIsEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete ${file.name}?`)) {
      await deleteItem(file.path);
    }
  };

  return (
    <div className="file-tree-item">
      <div
        className={`file-row ${isActive ? 'is-active' : ''}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={handleClick}
      >
        <span className="file-row-icon">
          {file.is_dir
            ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
            : <FileText size={13} strokeWidth={1.5} />
          }
        </span>
        
        {isEditing ? (
          <input 
             className="inline-edit-input"
             autoFocus
             value={editValue}
             onClick={e => e.stopPropagation()}
             onChange={e => setEditValue(e.target.value)}
             onBlur={() => handleRename()}
             onKeyDown={e => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') { setIsEditing(false); setEditValue(file.name.replace(/\.md$/, '')); }
             }}
             style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', outline: 'none', fontSize: 'inherit', fontFamily: 'inherit' }}
          />
        ) : (
          <span className="file-row-name">{file.name.replace(/\.md$/, '')}</span>
        )}

        <div className="file-row-actions">
          {!isEditing && (
            <>
              <button className="action-btn" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} title="Rename">
                <Edit3 size={11} />
              </button>
              <button className="action-btn" onClick={handleDelete} title="Delete">
                <Trash2 size={11} />
              </button>
            </>
          )}
          {!file.is_dir && !isEditing && (
            <button
              className={`star-btn ${file.isFavorite ? 'is-starred' : ''}`}
              onClick={handleStar}
              title={file.isFavorite ? 'Unstar' : 'Star'}
            >
              <Star size={12} fill={file.isFavorite ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {file.is_dir && open && file.children && (
          <motion.div
            className="children-container"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
          >
            {file.children.map(child => (
              <FileRow key={child.path} file={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ─── Inline Input ───────────────────────────────────────── */
const InlineAdd: React.FC<{
  type: 'file' | 'folder';
  onSubmit: (name: string) => void;
  onCancel: () => void;
}> = ({ type, onSubmit, onCancel }) => {
  const [val, setVal] = useState('');

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { if (val.trim()) onSubmit(val.trim()); }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="inline-add-form">
      {type === 'folder' ? <FolderOpen size={13} /> : <FileText size={13} />}
      <input
        autoFocus
        placeholder={type === 'folder' ? 'Folder name…' : 'Note name…'}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => !val && onCancel()}
      />
      <button className="icon-btn sm" onClick={onCancel} title="Cancel">
        <X size={12} />
      </button>
    </div>
  );
};

/* ─── Sidebar ────────────────────────────────────────────── */
export const Sidebar: React.FC = () => {
  const { files, createFile, createFolder, vaultPath, refresh, isRefreshing } = useStore();
  const [adding, setAdding] = useState<'file' | 'folder' | null>(null);

  const handleSubmit = async (name: string) => {
    if (!adding) return;
    if (adding === 'file') await createFile(name);
    else await createFolder(name);
    setAdding(null);
  };

  if (!vaultPath) return null;

  const vaultName = vaultPath.split('/').pop() ?? 'Vault';

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="sidebar-vault-name">{vaultName}</span>
          <button 
            onClick={() => useStore.getState().testToast()} 
            style={{ fontSize: '0.65rem', background: 'var(--bg-3)', border: '1px solid var(--bd-1)', borderRadius: '3px', cursor: 'pointer', padding: '2px 4px' }}
          >
            Test Toasts
          </button>
        </div>
        <div className="sidebar-actions">
          <button 
            className={`icon-btn sm ${isRefreshing ? 'spinning' : ''}`} 
            onClick={() => refresh()} 
            title="Refresh vault"
            disabled={isRefreshing}
          >
            <RotateCw size={14} />
          </button>
          <button className="icon-btn sm" onClick={() => setAdding('file')} title="New note (⌘N)">
            <Plus size={14} />
          </button>
          <button className="icon-btn sm" onClick={() => setAdding('folder')} title="New folder">
            <FolderPlus size={14} />
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="sidebar-scroll">
        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{ overflow: 'hidden' }}
            >
              <InlineAdd
                type={adding}
                onSubmit={handleSubmit}
                onCancel={() => setAdding(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {files.map(file => (
          <FileRow key={file.path} file={file} depth={0} />
        ))}

        {files.length === 0 && !adding && (
          <div style={{ padding: '20px 14px', color: 'var(--tx-3)', fontSize: '0.82rem' }}>
            No notes yet. Press <strong>+</strong> to create one.
          </div>
        )}
      </div>

      {/* Local Graph */}
      <div className="local-graph-panel">
        <div className="local-graph-label">Local Graph</div>
        <div className="local-graph-canvas">
          <GraphView isMini />
        </div>
      </div>
    </div>
  );
};
