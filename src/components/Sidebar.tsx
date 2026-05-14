import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';
import {
  FileText, FolderOpen, ChevronRight, ChevronDown,
  Plus, FolderPlus, Star, X, RotateCw, Edit3, Trash2,
  LayoutTemplate, Save, Copy, ExternalLink, Heart, Layout, Kanban
} from 'lucide-react';
import { openPath as openExternal } from '@tauri-apps/plugin-opener';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';

import nopi00 from '../assets/nopi/pet_00.png';
import nopi05 from '../assets/nopi/pet_05.png';
import nopi09 from '../assets/nopi/pet_09.png';
import nopi14 from '../assets/nopi/pet_14.png';
import nopi28 from '../assets/nopi/pet_28.png';
import nopi32 from '../assets/nopi/pet_32.png';
import nopi42 from '../assets/nopi/pet_42.png';
import nopi46 from '../assets/nopi/pet_46.png';

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
  const { openFile, activeTab, toggleFavorite, renameItem, deleteItem, moveItem } = useStore();
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(file.name.replace(/\.md$/, ''));
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
    e.preventDefault();

    // Use native confirm dialog
    const shouldDelete = window.confirm(`Are you sure you want to delete "${file.name}"?\n\nThis action cannot be undone.`);
    if (shouldDelete) {
      await deleteItem(file.path);
    }
  };

  // Drag handlers for files
  const handleDragStart = (e: React.DragEvent) => {
    if (file.is_dir) return; // Only files can be dragged
    e.dataTransfer.setData('text/plain', file.path);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Drop handlers for folders
  const handleDragOver = (e: React.DragEvent) => {
    if (!file.is_dir) return; // Only folders can receive drops
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!file.is_dir) return;
    e.preventDefault();
    setIsDragOver(false);

    const sourcePath = e.dataTransfer.getData('text/plain');
    if (sourcePath && sourcePath !== file.path) {
      await moveItem(sourcePath, file.path);
      setOpen(true); // Auto-expand folder after drop
    }
  };

  return (
    <div className="file-tree-item">
      <div
        className={`file-row ${isActive ? 'is-active' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={handleClick}
        draggable={!file.is_dir}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
              <button 
                className="action-btn delete-btn" 
                onClick={handleDelete}
                title="Delete"
              >
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

/* ─── Digital Pet ─────────────────────────────────────────── */
const DigitalPet: React.FC = () => {
  const { allFiles, graphData } = useStore();
  const [speech, setSpeech] = useState<string | null>(null);

  useEffect(() => {
    const quotes = [
      "Meow! 🐱",
      "Try adding #task to organize quests!",
      "Checking off boxes gives me XP! ✅",
      "Use #creative for a purple aura ✨",
      "Keep that combo going! 🔥",
      "Use #journal to start your daily log 📝"
    ];

    const interval = setInterval(() => {
      if (Math.random() > 0.6) {
        setSpeech(quotes[Math.floor(Math.random() * quotes.length)]);
        setTimeout(() => setSpeech(null), 5000);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const xp = (allFiles.length * 10) + (graphData.links.length * 5);
  const level = Math.floor(Math.sqrt(Math.max(xp, 0) / 10)) + 1;
  const currentLevelBaseXp = Math.pow(level - 1, 2) * 10;
  const nextLevelXp = Math.pow(level, 2) * 10;
  
  const progress = ((xp - currentLevelBaseXp) / (nextLevelXp - currentLevelBaseXp)) * 100;

  let petFace = nopi00;
  let status = 'Purring';
  
  if (level < 5) { petFace = nopi00; status = 'Curious'; }
  else if (level < 10) { petFace = nopi05; status = 'Playful'; }
  else if (level < 15) { petFace = nopi09; status = 'Sneaky'; }
  else if (level < 20) { petFace = nopi14; status = 'Armored'; }
  else if (level < 25) { petFace = nopi28; status = 'Golden'; }
  else if (level < 35) { petFace = nopi32; status = 'Elemental'; }
  else if (level < 43) { petFace = nopi42; status = 'Ethereal'; }
  else { petFace = nopi46; status = 'Majestic'; }

  return (
    <div className="digital-pet-widget">
      <div className="pet-header">
        <span className="pet-name">Nopi</span>
        <span className="pet-level">Lvl {level}</span>
      </div>
      <div className="pet-avatar-container">
        {speech && (
          <motion.div 
            className="pet-speech-bubble"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            {speech}
          </motion.div>
        )}
        <img src={petFace} alt="Nopi" className="pet-avatar-img" />
        <div className="pet-status">{status}</div>
      </div>
      <div className="pet-xp-bar">
        <div className="pet-xp-fill" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>
      <div className="pet-xp-text">{xp} / {nextLevelXp} XP</div>
    </div>
  );
};

/* ─── Template Manager ─────────────────────────────────── */
const TemplateManager: React.FC = () => {
  const { templates, saveTemplate, deleteTemplate, insertTemplate, tabContents, activeTab } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateCategory, setTemplateCategory] = useState('General');

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    const content = activeTab ? (tabContents[activeTab] ?? '') : '';
    if (!content.trim()) {
      toast.error('Cannot save empty note as template');
      return;
    }
    saveTemplate({
      name: templateName.trim(),
      content,
      category: templateCategory,
    });
    setShowSaveModal(false);
    setTemplateName('');
    setTemplateCategory('General');
  };

  return (
    <>
      <div className="template-manager">
        <button className="template-toggle" onClick={() => setIsOpen(!isOpen)}>
          <LayoutTemplate size={14} />
          <span>Templates ({templates.length})</span>
          <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
        
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="template-list"
          >
            {templates.length === 0 && (
              <div className="template-empty">No templates saved yet</div>
            )}
            {templates.map(t => (
              <div key={t.id} className="template-item">
                <span className="template-name">{t.name}</span>
                <span className="template-category">{t.category}</span>
                <button 
                  className="template-insert" 
                  onClick={() => insertTemplate(t.id)}
                  title="Insert template into current note"
                  disabled={!activeTab}
                >
                  Use
                </button>
                <button 
                  className="template-delete" 
                  onClick={() => deleteTemplate(t.id)}
                  title="Delete template"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
        
        <button className="template-save-btn" onClick={() => setShowSaveModal(true)}>
          <Save size={12} />
          <span>Save Current as Template</span>
        </button>
      </div>

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Save as Template</div>
            <label className="modal-label">Template Name</label>
            <input
              className="modal-input"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="e.g., Meeting Notes"
              autoFocus
            />
            <label className="modal-label">Category</label>
            <input
              className="modal-input"
              value={templateCategory}
              onChange={e => setTemplateCategory(e.target.value)}
              placeholder="e.g., Work, Personal"
            />
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="modal-btn primary" onClick={handleSaveTemplate} disabled={!templateName.trim()}>
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
        <span className="sidebar-vault-name">{vaultName}</span>
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

      <TemplateManager />
      <DigitalPet />

    </div>
  );
};
