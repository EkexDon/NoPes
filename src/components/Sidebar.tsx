import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import {
  FileText, FolderOpen, ChevronRight, ChevronDown,
  Plus, FolderPlus, Star, X,
} from 'lucide-react';
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
  const { openFile, activeTab, toggleFavorite } = useStore();
  const [open, setOpen] = useState(false);
  const isActive = activeTab === file.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (file.is_dir) setOpen(o => !o);
    else openFile(file.path);
  };

  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!file.is_dir) toggleFavorite(file.path);
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
        <span className="file-row-name">{file.name.replace(/\.md$/, '')}</span>
        {!file.is_dir && (
          <button
            className={`star-btn ${file.isFavorite ? 'is-starred' : ''}`}
            onClick={handleStar}
            title={file.isFavorite ? 'Unstar' : 'Star'}
          >
            <Star size={12} fill={file.isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
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
  const { files, createFile, createFolder, vaultPath } = useStore();
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
        <span className="sidebar-vault-name">{vaultName}</span>
        <div className="sidebar-actions">
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
