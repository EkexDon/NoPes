import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useStore, FileMetadata } from '../store/useStore';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { 
  FileText, 
  Layout, 
  Kanban, 
  Folder, 
  Star, 
  Clock, 
  Grid3X3,
  Plus,
  Search,
  MoreHorizontal,
  Smile,
  Type,
  ExternalLink,
  FolderOpen,
  Trash2,
  Edit3,
  Copy,
  Heart,
  Palette,
  LayoutGrid,
  Columns
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';

// Icon picker component for selecting emoji/icons
const IconPicker: React.FC<{
  currentIcon?: string;
  currentType?: 'emoji' | 'lucide';
  onSelect: (icon: string, type: 'emoji' | 'lucide') => void;
  onClose: () => void;
}> = ({ currentIcon, currentType, onSelect, onClose }) => {
  const [activeTab, setActiveTab] = useState<'emoji' | 'icons'>(currentType === 'lucide' ? 'icons' : 'emoji');
  
  // Common emojis for notes
  const emojiCategories = {
    recent: ['📄', '📝', '📚', '💡', '✅', '⚡', '🎯', '📊'],
    objects: ['📁', '📂', '🗂️', '📋', '📌', '📎', '🔗', '📎', '✂️', '📐', '📏', '📌'],
    symbols: ['⭐', '❤️', '💜', '💙', '💚', '💛', '🧡', '🖤', '🤍', '🤎'],
    nature: ['🌟', '🔥', '💫', '⭐', '🌙', '☀️', '🌈', '💧', '🌊', '🌸'],
    tech: ['💻', '⌨️', '🖥️', '🖱️', '💾', '💿', '📀', '🎮', '📱', '🔋'],
  };
  
  // Lucide icons for more professional look
  const lucideIcons = [
    'FileText', 'BookOpen', 'Lightbulb', 'Target', 'Star', 'Heart',
    'Folder', 'Bookmark', 'Flag', 'Tag', 'Clock', 'Calendar',
    'BarChart', 'PieChart', 'TrendingUp', 'Activity', 'Zap',
    'Code', 'Terminal', 'Database', 'Server', 'Cloud',
    'Home', 'Settings', 'User', 'Users', 'Mail', 'MessageSquare'
  ];

  return (
    <div className="icon-picker-overlay" onClick={onClose}>
      <div className="icon-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="icon-picker-header">
          <h3>Choose Icon</h3>
          <div className="icon-picker-tabs">
            <button 
              className={activeTab === 'emoji' ? 'active' : ''}
              onClick={() => setActiveTab('emoji')}
            >
              <Smile size={16} />
              Emoji
            </button>
            <button 
              className={activeTab === 'icons' ? 'active' : ''}
              onClick={() => setActiveTab('icons')}
            >
              <Type size={16} />
              Icons
            </button>
          </div>
        </div>
        
        <div className="icon-picker-content">
          {activeTab === 'emoji' ? (
            <div className="emoji-grid">
              {Object.entries(emojiCategories).map(([category, emojis]) => (
                <div key={category} className="emoji-category">
                  <span className="emoji-category-label">{category}</span>
                  <div className="emoji-row">
                    {emojis.map(emoji => (
                      <button
                        key={emoji}
                        className={`emoji-btn ${currentIcon === emoji ? 'selected' : ''}`}
                        onClick={() => onSelect(emoji, 'emoji')}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="lucide-grid">
              {lucideIcons.map(iconName => {
                const Icon = require('lucide-react')[iconName];
                return (
                  <button
                    key={iconName}
                    className={`lucide-btn ${currentIcon === iconName ? 'selected' : ''}`}
                    onClick={() => onSelect(iconName, 'lucide')}
                    title={iconName}
                  >
                    {Icon && <Icon size={20} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        <div className="icon-picker-footer">
          <button className="icon-picker-close" onClick={onClose}>Cancel</button>
          <button 
            className="icon-picker-clear"
            onClick={() => onSelect('', 'emoji')}
          >
            Clear Icon
          </button>
        </div>
      </div>
    </div>
  );
};

// Individual card component for each item
const HomeCard: React.FC<{
  item: { path: string; name: string; is_dir?: boolean };
  metadata?: FileMetadata;
  isFavorite?: boolean;
  onOpen: () => void;
  onIconChange?: (icon: string, type: 'emoji' | 'lucide') => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({ item, metadata, isFavorite, onOpen, onIconChange, onContextMenu }) => {
  const [showIconPicker, setShowIconPicker] = useState(false);
  
  const getIcon = () => {
    if (metadata?.icon) {
      if (metadata.iconType === 'emoji') {
        return <span className="card-icon-emoji">{metadata.icon}</span>;
      } else if (metadata.iconType === 'lucide') {
        // Dynamic import would be better, but for now use a mapping
        const iconMap: Record<string, React.ReactNode> = {
          'FileText': <FileText size={32} />,
          'Layout': <Layout size={32} />,
          'Kanban': <Kanban size={32} />,
          'Folder': <Folder size={32} />,
        };
        return iconMap[metadata.icon] || <FileText size={32} />;
      }
    }
    
    // Default icons based on type
    if (item.is_dir) return <Folder size={32} className="card-icon-default" />;
    if (metadata?.itemType === 'canvas') return <Layout size={32} className="card-icon-canvas" />;
    if (metadata?.itemType === 'kanban') return <Kanban size={32} className="card-icon-kanban" />;
    return <FileText size={32} className="card-icon-note" />;
  };
  
  const getTypeLabel = () => {
    if (item.is_dir) return 'Folder';
    if (metadata?.itemType === 'canvas') return 'Canvas';
    if (metadata?.itemType === 'kanban') return 'Kanban';
    return 'Note';
  };
  
  const getColor = () => {
    if (metadata?.color) return metadata.color;
    if (item.is_dir) return 'var(--accent)';
    if (metadata?.itemType === 'canvas') return '#a78bfa';
    if (metadata?.itemType === 'kanban') return '#34d399';
    return 'var(--accent-light)';
  };
  
  return (
    <>
      <motion.div
        className="home-card"
        whileHover={{ y: -2, scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        style={{ borderColor: getColor() }}
      >
        <div 
          className="home-card-icon-wrapper"
          style={{ backgroundColor: `${getColor()}15` }}
          onClick={e => {
            e.stopPropagation();
            setShowIconPicker(true);
          }}
        >
          {getIcon()}
          <div className="home-card-icon-edit">
            <MoreHorizontal size={14} />
          </div>
        </div>
        
        <div className="home-card-content">
          <h4 className="home-card-title">{item.name.replace(/\.md$/, '')}</h4>
          <span className="home-card-type">{getTypeLabel()}</span>
        </div>
        
        {isFavorite && (
          <div className="home-card-favorite">
            <Star size={14} fill="currentColor" />
          </div>
        )}
      </motion.div>
      
      {showIconPicker && onIconChange && (
        <IconPicker
          currentIcon={metadata?.icon}
          currentType={metadata?.iconType === 'image' ? 'emoji' : metadata?.iconType}
          onSelect={(icon, type) => {
            onIconChange(icon, type);
            setShowIconPicker(false);
          }}
          onClose={() => setShowIconPicker(false)}
        />
      )}
    </>
  );
};

// Section component for grouping cards
const HomeSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  items: { path: string; name: string; is_dir?: boolean }[];
  fileMetadata: Record<string, FileMetadata>;
  favorites: string[];
  onOpenItem: (path: string) => void;
  onIconChange: (path: string, icon: string, type: 'emoji' | 'lucide') => void;
  onContextMenu?: (item: { path: string; name: string }, event: React.MouseEvent) => void;
  emptyMessage?: string;
}> = ({ title, icon, items, fileMetadata, favorites, onOpenItem, onIconChange, onContextMenu, emptyMessage }) => {
  if (items.length === 0 && emptyMessage) {
    return (
      <div className="home-section">
        <div className="home-section-header">
          {icon}
          <h3>{title}</h3>
          <span className="home-section-count">0</span>
        </div>
        <div className="home-section-empty">{emptyMessage}</div>
      </div>
    );
  }
  
  if (items.length === 0) return null;
  
  return (
    <div className="home-section">
      <div className="home-section-header">
        {icon}
        <h3>{title}</h3>
        <span className="home-section-count">{items.length}</span>
      </div>
      
      <div className="home-grid">
        {items.map((item, index) => (
          <motion.div
            key={item.path}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <HomeCard
              item={item}
              metadata={fileMetadata[item.path]}
              isFavorite={favorites.includes(item.path)}
              onOpen={() => onOpenItem(item.path)}
              onIconChange={(icon, type) => onIconChange(item.path, icon, type)}
              onContextMenu={onContextMenu ? (e) => onContextMenu(item, e) : undefined}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// Main HomeView component
export const HomeView: React.FC = () => {
  const { 
    allFiles, 
    fileMetadata, 
    favorites, 
    recentFiles,
    openFile, 
    setViewMode,
    setFileIcon,
    createFile,
    createCanvasFile,
    createKanbanFile,
    toggleFavorite,
    renameItem,
    deleteItem,
    revealInFinder,
    copyToClipboard,
    duplicateFile
  } = useStore();
  
  const { menu, showMenu, hideMenu } = useContextMenu();
  
  const [filter, setFilter] = useState<'all' | 'notes' | 'canvas' | 'kanban' | 'folders'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [itemToDelete, setItemToDelete] = useState<{ path: string; name: string } | null>(null);
  
  // Get all items (files and folders)
  const allItems = useMemo(() => {
    const items: { path: string; name: string; is_dir?: boolean }[] = [];
    
    const traverse = (entries: any[]) => {
      for (const entry of entries) {
        if (entry.is_dir) {
          items.push({ path: entry.path, name: entry.name, is_dir: true });
          if (entry.children) traverse(entry.children);
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.canvas') || entry.name.endsWith('.kanban')) {
          items.push({ path: entry.path, name: entry.name });
        }
      }
    };
    
    // Flatten the file tree
    const flattenFiles = (files: any[]): any[] => {
      let flat: any[] = [];
      for (const f of files) {
        flat.push(f);
        if (f.children) flat = flat.concat(flattenFiles(f.children));
      }
      return flat;
    };
    
    // Get files from store
    const store = useStore.getState();
    const files = flattenFiles(store.files);
    
    for (const f of files) {
      if (f.is_dir) {
        items.push({ path: f.path, name: f.name, is_dir: true });
      } else if (f.name.endsWith('.md')) {
        items.push({ path: f.path, name: f.name });
      }
    }
    
    return items;
  }, [allFiles]);
  
  // Detect file types from content (Canvas/Kanban markers)
  useEffect(() => {
    const detectTypes = async () => {
      const store = useStore.getState();
      const { fileMetadata, setFileMetadata, tabContents } = store;
      
      for (const item of allItems) {
        if (item.is_dir || !item.path.endsWith('.md')) continue;
        
        // Skip if type already detected
        const existingType = fileMetadata[item.path]?.itemType;
        if (existingType && existingType !== 'note') continue;
        
        try {
          // Check tabContents first (already loaded files)
          let content = tabContents[item.path];
          
          // If not in memory, read from disk
          if (!content) {
            content = await readTextFile(item.path);
          }
          
          // Detect type from content
          let detectedType: FileMetadata['itemType'] = 'note';
          if (content.includes('<!-- CANVAS -->') || content.includes('data-canvas="true"')) {
            detectedType = 'canvas';
          } else if (content.includes('<!-- KANBAN -->') || content.includes('data-kanban="true"')) {
            detectedType = 'kanban';
          }
          
          // Update metadata if different
          if (detectedType !== 'note') {
            setFileMetadata(item.path, {
              itemType: detectedType,
              iconType: fileMetadata[item.path]?.iconType || 'emoji'
            });
          }
        } catch (e) {
          // File might not exist or be unreadable
        }
      }
    };
    
    detectTypes();
  }, [allItems]);
  
  // Filter items
  const filteredItems = useMemo(() => {
    let items = allItems;
    
    // Type filter
    if (filter !== 'all') {
      items = items.filter(item => {
        if (filter === 'folders') return item.is_dir;
        const type = fileMetadata[item.path]?.itemType;
        if (filter === 'notes') return type === 'note' || (!type && !item.is_dir);
        if (filter === 'canvas') return type === 'canvas';
        if (filter === 'kanban') return type === 'kanban';
        return true;
      });
    }
    
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item => 
        item.name.toLowerCase().includes(q) ||
        fileMetadata[item.path]?.description?.toLowerCase().includes(q)
      );
    }
    
    return items;
  }, [allItems, filter, searchQuery, fileMetadata]);
  
  // Get favorite items
  const favoriteItems = useMemo(() => {
    return allItems.filter(item => favorites.includes(item.path));
  }, [allItems, favorites]);
  
  // Get recent items
  const recentItems = useMemo(() => {
    return recentFiles
      .map(path => allItems.find(item => item.path === path))
      .filter(Boolean)
      .slice(0, 8) as { path: string; name: string; is_dir?: boolean }[];
  }, [allItems, recentFiles]);
  
  const handleOpenItem = async (path: string) => {
    if (path.endsWith('.md')) {
      await openFile(path);
      // openFile now automatically detects canvas/kanban and sets viewMode
      // Don't override it here anymore
    } else {
      // Handle folders or other types
      toast('Opening...', { duration: 1000 });
    }
  };
  
  const handleIconChange = (path: string, icon: string, type: 'emoji' | 'lucide') => {
    setFileIcon(path, icon, type);
  };
  
  const handleCreateNew = (type: 'note' | 'canvas' | 'kanban') => {
    if (type === 'note') {
      createFile('Untitled');
    } else if (type === 'canvas') {
      createCanvasFile('Untitled Canvas');
    } else if (type === 'kanban') {
      createKanbanFile('Untitled Kanban');
    }
    setShowNewMenu(false);
  };

  // Build context menu items for a file
  const buildContextMenu = (item: { path: string; name: string; is_dir?: boolean }) => {
    const isFav = favorites.includes(item.path);
    const meta = fileMetadata[item.path];
    const isCanvas = meta?.itemType === 'canvas';
    const isKanban = meta?.itemType === 'kanban';
    
    const menuItems = [
      {
        id: 'open',
        label: 'Open',
        icon: <FileText size={16} />,
        action: () => openFile(item.path),
      },
      {
        id: 'open-folder',
        label: 'Open in Folder',
        icon: <FolderOpen size={16} />,
        action: () => {
          // Navigate to folder in sidebar - just open the file for now
          openFile(item.path);
          // Could expand sidebar folder in future
        },
      },
      { id: 'divider1', label: '', divider: true, action: () => {} },
      {
        id: 'favorite',
        label: isFav ? 'Remove from Favorites' : 'Add to Favorites',
        icon: <Heart size={16} />,
        action: () => toggleFavorite(item.path),
      },
      {
        id: 'icon',
        label: 'Change Icon',
        icon: <Palette size={16} />,
        action: () => {
          // Trigger icon picker - this would need a callback to parent
          // For now, we'll just set a default
          setFileIcon(item.path, '📝', 'emoji');
        },
      },
      { id: 'divider2', label: '', divider: true, action: () => {} },
      {
        id: 'reveal',
        label: 'Reveal in Finder',
        icon: <ExternalLink size={16} />,
        action: () => revealInFinder(item.path),
      },
      {
        id: 'copy-path',
        label: 'Copy Path',
        icon: <Copy size={16} />,
        action: () => copyToClipboard(item.path),
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: <LayoutGrid size={16} />,
        action: () => duplicateFile(item.path),
      },
      { id: 'divider3', label: '', divider: true, action: () => {} },
      {
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 size={16} />,
        action: () => setItemToDelete({ path: item.path, name: item.name }),
      },
    ];

    // Add view mode options for special files
    if (isCanvas) {
      menuItems.splice(2, 0, {
        id: 'view-canvas',
        label: 'View as Canvas',
        icon: <Layout size={16} />,
        action: () => {
          openFile(item.path);
          setViewMode('canvas');
        },
      });
    }
    if (isKanban) {
      menuItems.splice(2, 0, {
        id: 'view-kanban',
        label: 'View as Kanban',
        icon: <Kanban size={16} />,
        action: () => {
          openFile(item.path);
          setViewMode('kanban');
        },
      });
    }

    return menuItems;
  };
  
  return (
    <div className="home-view">
      {/* Header */}
      <div className="home-header">
        <div className="home-header-left">
          <h1>🏠 Home</h1>
          <span className="home-subtitle">{allItems.length} items in your vault</span>
        </div>
        
        <div className="home-header-right">
          {/* Search */}
          <div className="home-search">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search your vault..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          
          {/* New Button */}
          <div className="home-new-wrapper">
            <button 
              className="home-new-btn"
              onClick={() => setShowNewMenu(!showNewMenu)}
            >
              <Plus size={16} />
              New
            </button>
            
            {showNewMenu && (
              <div className="home-new-menu">
                <button onClick={() => handleCreateNew('note')}>
                  <FileText size={16} />
                  New Note
                </button>
                <button onClick={() => handleCreateNew('canvas')}>
                  <Layout size={16} />
                  New Canvas
                </button>
                <button onClick={() => handleCreateNew('kanban')}>
                  <Kanban size={16} />
                  New Kanban
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Filter Bar */}
      <div className="home-filter-bar">
        <div className="home-filters">
          {(['all', 'notes', 'canvas', 'kanban', 'folders'] as const).map(f => (
            <button
              key={f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && <Grid3X3 size={14} />}
              {f === 'notes' && <FileText size={14} />}
              {f === 'canvas' && <Layout size={14} />}
              {f === 'kanban' && <Kanban size={14} />}
              {f === 'folders' && <Folder size={14} />}
              <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* Content */}
      <div className="home-content">
        {/* Favorites Section */}
        <HomeSection
          title="Favorites"
          icon={<Star size={18} fill="currentColor" />}
          items={favoriteItems}
          fileMetadata={fileMetadata}
          favorites={favorites}
          onOpenItem={handleOpenItem}
          onIconChange={handleIconChange}
          onContextMenu={(item, e) => showMenu(buildContextMenu(item), e)}
          emptyMessage="Pin your favorite items for quick access"
        />
        
        {/* Recent Section */}
        <HomeSection
          title="Recent"
          icon={<Clock size={18} />}
          items={recentItems}
          fileMetadata={fileMetadata}
          favorites={favorites}
          onOpenItem={handleOpenItem}
          onIconChange={handleIconChange}
          onContextMenu={(item, e) => showMenu(buildContextMenu(item), e)}
        />
        
        {/* All Content Section */}
        <HomeSection
          title={filter === 'all' ? 'All Content' : `${filter.charAt(0).toUpperCase() + filter.slice(1)}`}
          icon={<Grid3X3 size={18} />}
          items={filteredItems}
          fileMetadata={fileMetadata}
          favorites={favorites}
          onOpenItem={handleOpenItem}
          onIconChange={handleIconChange}
          onContextMenu={(item, e) => showMenu(buildContextMenu(item), e)}
          emptyMessage={searchQuery ? "No items match your search" : "No items to display"}
        />
      </div>
      
      {/* Context Menu */}
      {menu && (
        <ContextMenu
          items={menu.items}
          position={menu.position}
          onClose={hideMenu}
        />
      )}

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="modal-overlay" onClick={() => setItemToDelete(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Delete Item</div>
            <p style={{ color: 'var(--tx-2)', marginBottom: 20 }}>
              Are you sure you want to delete <strong>"{itemToDelete.name}"</strong>?
              <br />
              <span style={{ fontSize: '0.875rem', color: 'var(--tx-3)' }}>
                This action cannot be undone.
              </span>
            </p>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setItemToDelete(null)}>
                Cancel
              </button>
              <button 
                className="btn danger" 
                onClick={() => {
                  deleteItem(itemToDelete.path);
                  setItemToDelete(null);
                }}
                style={{ background: '#f87171', color: '#fff' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
