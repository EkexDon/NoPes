import { create } from 'zustand';
import { join, basename, dirname } from '@tauri-apps/api/path';
import { 
  readFile, 
  readTextFile, 
  writeFile,
  writeTextFile, 
  readDir, 
  mkdir, 
  remove,
  rename,
  exists,
  stat
} from '@tauri-apps/plugin-fs';
import { toast } from 'react-hot-toast';
import { AIService } from '../workers/AIService';

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileInfo[];
  isFavorite?: boolean;
}

export interface Tab {
  path: string;
  label: string;
}

export interface MediaItem {
  id: string;
  type: 'image' | 'video';
  src: string;
}

interface GraphData {
  nodes: { id: string; label: string; tags?: string[] }[];
  links: { source: string; target: string }[];
}

interface AppState {
  vaultPath: string | null;
  files: FileInfo[];
  allFiles: FileInfo[];
  favorites: string[];

  // Multi-tab support
  tabs: Tab[];
  activeTab: string | null;
  tabContents: Record<string, string>; // path -> content

  // Rich Media Assets awaiting insertion into the editor
  pendingAssetInserts: string[];
  // Media assets (images, videos) awaiting insertion
  media: MediaItem[];

  isSidebarOpen: boolean;
  isRefreshing: boolean;
  graphData: GraphData;
  viewMode: 'editor' | 'graph' | 'journal' | 'canvas';

  // Split View Multi-Pane Support
  isSplitView: boolean;
  rightActiveTab: string | null;
  rightViewMode: 'editor' | 'graph' | 'journal' | 'canvas';
  setSplitView: (isSplit: boolean) => void;
  setRightActiveTab: (path: string | null) => void;
  setRightViewMode: (mode: 'editor' | 'graph' | 'journal' | 'canvas') => void;
  toggleSplitView: () => void;

  // Journal / Heatmap
  journalStats: Record<string, number>; // 'YYYY-MM-DD' -> word count

  // AI Semantic Search & API Key
  aiIndex: { path: string; label: string; vec: Float32Array }[];
  aiApiKey: string | null;

  // ── Actions ──
  setVaultPath: (path: string) => Promise<void>;
  loadFiles: () => Promise<void>;

  openFile: (path: string) => Promise<void>;      // main open – adds tab + loads
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;

  createFile: (name: string, folderPath?: string) => Promise<void>;
  createFolder: (name: string, parentPath?: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  renameItem: (oldPath: string, newName: string) => Promise<void>;
  toggleFavorite: (path: string) => void;

  setPendingAssetInserts: (assets: string[]) => void;
  addMedia: (item: MediaItem) => void;

  loadGraphData: (override?: { path: string; text: string }) => Promise<void>;
  setSidebarOpen: (v: boolean) => void;
  setViewMode: (mode: 'editor' | 'graph' | 'journal' | 'canvas') => void;
  
  createNodeFromGraph: () => Promise<void>;
  computeJournalStats: () => Promise<void>;
  buildAiIndex: () => Promise<void>;
  setAiApiKey: (key: string) => void;

  // File conversion/import
  importFiles: (paths: string[]) => Promise<void>;
  convertDocx: (path: string, dir: string, silent?: boolean) => Promise<FileInfo | null>;
  refresh: () => Promise<void>;
  testToast: () => void;

  // Convenience getter
  activeContent: () => string;
}

/** Extract [[wikilinks]] from text, handles raw AND backslash-escaped variants */
export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const raw     = /\[\[([^\]|#\n]+?)(?:\|[^\]]+?)?\]\]/g;
  const escaped = /\\\[\\\[([^\]|#\n]+?)(?:\|[^\]]+?)?\\\]\\\]/g;
  let m;
  while ((m = raw.exec(text))     !== null) out.push(m[1].trim());
  while ((m = escaped.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

/** Extract #tags from text */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  const regex = /(?:^|\s)#([a-zA-Z0-9_\-]+)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (!out.includes(m[1].toLowerCase())) {
      out.push(m[1].toLowerCase());
    }
  }
  return out;
}

export const useStore = create<AppState>((set, get) => ({
  vaultPath: localStorage.getItem('nopes_vault_path'),
  files: [],
  allFiles: [],
  favorites: JSON.parse(localStorage.getItem('nopes_favorites') || '[]'),

  tabs: [],
  activeTab: null,
  tabContents: {},
  pendingAssetInserts: [],
  media: [],

  isSidebarOpen: true,
  isRefreshing: false,
  graphData: { nodes: [], links: [] },
  viewMode: 'editor',
  isSplitView: false,
  rightActiveTab: null,
  rightViewMode: 'graph',
  journalStats: {},
  aiIndex: [],
  aiApiKey: localStorage.getItem('nopes_ai_key'),

  activeContent: () => {
    const { activeTab, tabContents } = get();
    return activeTab ? (tabContents[activeTab] ?? '') : '';
  },

  setSplitView: (v) => set({ isSplitView: v }),
  setRightActiveTab: (path) => set({ rightActiveTab: path }),
  setRightViewMode: (mode) => set({ rightViewMode: mode }),
  toggleSplitView: () => set(s => ({ 
    isSplitView: !s.isSplitView,
    rightActiveTab: !s.isSplitView ? s.activeTab : s.rightActiveTab
  })),

  setVaultPath: async (path) => {
    set({ vaultPath: path });
    localStorage.setItem('nopes_vault_path', path);
    await get().loadFiles();
    await get().loadGraphData();
  },

  loadFiles: async () => {
    const { vaultPath, favorites } = get();
    if (!vaultPath) {
      console.warn('loadFiles: vaultPath is null');
      return;
    }

    set({ isRefreshing: true });
    try {
      const scan = async (dirPath: string): Promise<FileInfo[]> => {
        const entries = await readDir(dirPath);
        const results: FileInfo[] = [];

        for (const entry of entries) {
          const fullPath = await join(dirPath, entry.name);
          const info: FileInfo = {
            name: entry.name,
            path: fullPath,
            is_dir: entry.isDirectory,
            isFavorite: favorites.includes(fullPath)
          };

          if (entry.isDirectory) {
            info.children = await scan(fullPath);
          }
          results.push(info);
        }
        return results.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      };

      const rawScanResult = await scan(vaultPath);
      const filteredTree = rawScanResult.filter(f => 
        !f.name.toLowerCase().endsWith('.docx') && 
        f.name !== '_word_archive'
      );
      
      const flatten = (items: FileInfo[]): FileInfo[] => {
        let flat: FileInfo[] = [];
        for (const item of items) {
          flat.push(item);
          if (item.children) flat = flat.concat(flatten(item.children));
        }
        return flat;
      };

      const fullFlatList = flatten(rawScanResult);
      const filteredFlatList = fullFlatList.filter(f => 
        !f.is_dir && f.name.toLowerCase().endsWith('.md')
      );

      set({ files: filteredTree, allFiles: filteredFlatList });
      console.log('Scan complete. Found:', filteredFlatList.length, 'notes.');
      get().buildAiIndex();
      
      // Auto-convert any docx found in the scan
      for (const f of fullFlatList) {
        if (!f.is_dir && f.name.toLowerCase().endsWith('.docx')) {
          console.log('Auto-converting Word:', f.name);
          await get().convertDocx(f.path, await dirname(f.path), true);
        }
      }
    } catch (e: any) {
      console.error('loadFiles error:', e);
      toast.error(`Load failed: ${e.message || e}`);
    } finally {
      set({ isRefreshing: false });
    }
  },

  openFile: async (path) => {
    const { tabs, tabContents } = get();
    
    // Intercept Word files and convert on-the-fly
    if (path.toLowerCase().endsWith('.docx')) {
      const info = await get().convertDocx(path, await dirname(path));
      if (info) return get().openFile(info.path);
      return;
    }

    let content = tabContents[path];

    // load from disk if not already in memory
    if (content === undefined) {
      try { 
        content = await readTextFile(path); 
      } catch { 
        content = ''; 
      }
    }

    const name = await basename(path);
    const label = name.replace(/\.md$/, '') || 'Untitled';
    const alreadyOpen = tabs.some(t => t.path === path);

    set(state => ({
      tabs: alreadyOpen ? state.tabs : [...state.tabs, { path, label }],
      tabContents: { ...state.tabContents, [path]: content! },
      activeTab: path,
      viewMode: 'editor',
    }));

    await get().loadGraphData();
  },

  closeTab: (path) => {
    const { tabs, activeTab } = get();
    const idx = tabs.findIndex(t => t.path === path);
    const newTabs = tabs.filter(t => t.path !== path);
    let newActive = activeTab;
    if (activeTab === path) {
      // activate adjacent tab
      if (newTabs.length > 0) {
        newActive = newTabs[Math.max(0, idx - 1)].path;
      } else {
        newActive = null;
      }
    }
    set(state => {
      const tc = { ...state.tabContents };
      delete tc[path];
      return { tabs: newTabs, activeTab: newActive, tabContents: tc };
    });
  },

  setActiveTab: (path) => set({ activeTab: path, viewMode: 'editor' }),

  saveFile: async (path, content) => {
    try {
      await writeTextFile(path, content);
      set(state => ({ tabContents: { ...state.tabContents, [path]: content } }));
      await get().loadGraphData({ path, text: content });
    } catch (e) { console.error('saveFile error:', e); }
  },

  createFile: async (name, folderPath) => {
    const { vaultPath } = get();
    const base = folderPath || vaultPath;
    if (!base) return;
    try {
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const newPath = await join(base, fileName);
      await writeTextFile(newPath, '# ' + name);
      await get().loadFiles();
      await get().openFile(newPath);
    } catch (e) { console.error('createFile error:', e); }
  },

  createFolder: async (name, parentPath) => {
    const { vaultPath } = get();
    const base = parentPath || vaultPath;
    if (!base) return;
    try {
      const folderPath = await join(base, name);
      await mkdir(folderPath); 
      await get().loadFiles();
    } catch (e) { console.error('createFolder error:', e); }
  },

  deleteItem: async (path) => {
    try {
      await remove(path, { recursive: true });
      get().closeTab(path); // in case it's open
      await get().loadFiles();
      await get().loadGraphData();
      toast.success('Deleted item');
    } catch (e: any) {
      console.error('deleteItem error:', e);
      toast.error(`Delete failed: ${e.message || e}`);
    }
  },

  renameItem: async (oldPath, newName) => {
    try {
      const dir = await dirname(oldPath);
      const isMd = oldPath.endsWith('.md');
      let finalName = newName;
      if (isMd && !finalName.endsWith('.md')) finalName += '.md';
      
      const newPath = await join(dir, finalName);
      if (newPath === oldPath) return; // No change
      
      await rename(oldPath, newPath);
      
      const oldBase = oldPath.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? '';
      const newBase = finalName.replace(/\.md$/, '');
      
      const { tabs, tabContents, activeTab, allFiles } = get();
      
      // 1. Keep the tab open and seamlessly transition it
      const newTabs = tabs.map(t => t.path === oldPath ? { path: newPath, label: newBase } : t);
      const newActive = activeTab === oldPath ? newPath : activeTab;
      
      const newTabContents = { ...tabContents };
      if (newTabContents[oldPath] !== undefined) {
          newTabContents[newPath] = newTabContents[oldPath];
          delete newTabContents[oldPath];
      }
      
      // 2. Global WikiLink refactoring for the renamed doc!
      if (isMd && oldBase && newBase && oldBase !== newBase) {
        for (const f of allFiles) {
          if (f.is_dir || f.path === oldPath) continue; 
          
          let text = newTabContents[f.path];
          if (text === undefined) {
            try { text = await readTextFile(f.path); } catch { continue; }
          }
          
          // Safely escape any special characters in the old file name so the Regex doesn't fail
          const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexRaw = new RegExp(`\\[\\[(${escapeRegExp(oldBase)})(?:\\|([^\\]]+))?\\]\\]`, 'gi');
          
          let replaced = false;
          const newText = text.replace(regexRaw, (_match, _p1, p2) => {
             replaced = true;
             return p2 ? `[[${newBase}|${p2}]]` : `[[${newBase}]]`;
          });
          
          if (replaced) {
             newTabContents[f.path] = newText;
             // Write it to disk directly
             await writeTextFile(f.path, newText);
          }
        }
      }
      
      set({ tabs: newTabs, activeTab: newActive, tabContents: newTabContents });
      
      await get().loadFiles();
      await get().loadGraphData();
      toast.success(`Renamed to ${newBase} & updated links`);
    } catch (e: any) {
      console.error('renameItem error:', e);
      toast.error(`Rename failed: ${e.message || e}`);
    }
  },
  
  setPendingAssetInserts: (assets) => set({ pendingAssetInserts: assets }),
  addMedia: (item) => set(state => ({ media: [...state.media, item] })),

  toggleFavorite: (path) => {
    const { favorites } = get();
    const next = favorites.includes(path)
      ? favorites.filter(p => p !== path)
      : [...favorites, path];
    set({ favorites: next });
    localStorage.setItem('nopes_favorites', JSON.stringify(next));
    get().loadFiles();
  },

  loadGraphData: async (override?) => {
    const { allFiles } = get();
    if (!allFiles.length) return;
    try {
      const nodes: { id: string; label: string; tags: string[] }[] = [];
      const links: { source: string; target: string }[] = [];
      const byLabel = new Map(allFiles.map(f => [f.name.replace(/\.md$/, '').toLowerCase(), f.path]));

      for (const file of allFiles) {
        let text = '';
        if (override && file.path === override.path) {
          text = override.text;
        } else {
          const { tabContents } = get();
          text = tabContents[file.path] ?? '';
          if (!text) {
            try { text = await readTextFile(file.path); } catch { continue; }
          }
        }
        for (const target of extractWikilinks(text)) {
          const tp = byLabel.get(target.toLowerCase());
          if (tp && tp !== file.path) links.push({ source: file.path, target: tp });
        }
        nodes.push({ id: file.path, label: file.name.replace(/\.md$/, ''), tags: extractTags(text) });
      }
      set({ graphData: { nodes, links } });
    } catch (e) { console.error('Graph error:', e); }
  },

  setSidebarOpen: (v) => set({ isSidebarOpen: v }),
  setViewMode: (mode) => {
    set({ viewMode: mode });
    if (mode === 'graph') get().loadGraphData();
  },

  createNodeFromGraph: async () => {
    const id = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = `Untitled-${id}`;
    await get().createFile(name);
  },

  computeJournalStats: async () => {
    const { allFiles, tabContents } = get();
    const result: Record<string, number> = {};

    const countWords = (text: string) =>
      text.trim() ? text.trim().split(/\s+/).length : 0;

    for (const f of allFiles) {
      if (f.is_dir || !f.name.endsWith('.md')) continue;

      const name = f.name.replace(/\.md$/, '');
      let dateKey: string | null = null;

      // Primary: filename is already YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(name)) {
        dateKey = name;
      } else {
        // Fallback: use file birthtime/mtime from stat
        try {
          const info = await stat(f.path);
          const ts = info.birthtime ?? info.mtime;
          if (ts) {
            const d = new Date(ts);
            dateKey = d.toISOString().slice(0, 10);
          }
        } catch { /* non-critical */ }
      }

      if (!dateKey) continue;

      let text = tabContents[f.path];
      if (!text) {
        try { text = await readTextFile(f.path); } catch { continue; }
      }

      result[dateKey] = (result[dateKey] ?? 0) + countWords(text);
    }

    set({ journalStats: result });
  },

  buildAiIndex: async () => {
    const { allFiles, tabContents } = get();
    const docsToEmbed: { path: string; text: string }[] = [];
    
    for (const f of allFiles) {
      if (f.is_dir || !f.name.endsWith('.md')) continue;
      let text = tabContents[f.path];
      if (!text) {
        try { text = await readTextFile(f.path); } catch { continue; }
      }
      if (text.trim().length > 10) {
        docsToEmbed.push({ path: f.path, text });
      }
    }

    if (!docsToEmbed.length) return;
    try {
      const results = await AIService.embedDocs(docsToEmbed);
      const newIndex = results.map(r => ({
        path: r.path,
        label: r.path.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? 'Note',
        vec: r.vec
      }));
      set({ aiIndex: newIndex });
    } catch (err) {
      console.error('Failed to build AI index:', err);
    }
  },

  setAiApiKey: (key: string) => {
    localStorage.setItem('nopes_ai_key', key);
    set({ aiApiKey: key });
  },

  convertDocx: async (fullPath, dir, silent = false) => {
    const { favorites } = get();
    const fileName = fullPath.split(/[\\/]/).pop() || 'Untitled.docx';
    const toastId = !silent ? toast.loading(`Converting ${fileName}...`) : null;
    
    console.log('--- MASTER CONVERSION ATTEMPT ---', fullPath);
    
    try {
      // 1. Dynamic Discovery Strategy
      let mammoth: any = null;
      try {
        const mod = await import('mammoth');
        // Search the module for the conversion functions
        // @ts-ignore
        const discovery = [mod, mod.default, mod.mammoth].filter(Boolean);
        mammoth = discovery.find(o => typeof o.convertToMarkdown === 'function');
        
        if (!mammoth) {
          console.warn('Standard discovery failed, trying browser bundle...');
          // @ts-ignore
          const browserMod = await import('mammoth/mammoth.browser');
          // @ts-ignore
          const browserDiscovery = [browserMod, browserMod.default, (window as any).mammoth].filter(Boolean);
          mammoth = browserDiscovery.find(o => typeof o.convertToMarkdown === 'function');
        }
      } catch (e) {
        console.error('Discovery error:', e);
      }

      if (!mammoth) {
        throw new Error('Mammoth engine could not be identified in current environment.');
      }

      // 2. Data Preparation
      const uint8 = await readFile(fullPath);
      // Re-wrapping in a clean Uint8Array to ensure neutral byte alignment
      const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
      
      console.log('Engine ready. Starting binary transformation...', arrayBuffer.byteLength);

      // 3. Execution
      const result = await mammoth.convertToMarkdown({ arrayBuffer });
      
      if (!result || typeof result.value !== 'string') {
        throw new Error('Conversion engine returned an empty result.');
      }

      console.log('Conversion success! Length:', result.value.length);
      const mdFileName = fileName.replace(/\.docx$/i, '.md');
      const mdPath = await join(dir, mdFileName);
      
      await writeTextFile(mdPath, result.value);
      
      if (fullPath.startsWith(get().vaultPath!)) {
        // --- ARCHIVE LOGIC ---
        const archiveDir = await join(get().vaultPath!, '_word_archive');
        if (!await exists(archiveDir)) {
          await mkdir(archiveDir);
        }
        const archivePath = await join(archiveDir, fileName);
        console.log('Archiving Word source to:', archivePath);
        await rename(fullPath, archivePath);
      }
      
      if (toastId) toast.success(`Converted ${fileName}`, { id: toastId });

      return { 
        name: mdFileName, 
        path: mdPath, 
        is_dir: false, 
        isFavorite: favorites.includes(mdPath) 
      };
    } catch (err: any) {
      const technicalMsg = err.message || JSON.stringify(err);
      console.error('CRITICAL CONVERSION FAILURE:', technicalMsg, err);
      if (toastId) {
        toast.error(`Conversion failed: ${technicalMsg}`, { id: toastId, duration: 25000 });
      } else if (!silent) {
        toast.error(`Auto-conversion failed: ${technicalMsg}`, { duration: 10000 });
      }
      return null;
    }
  },

  importFiles: async (paths) => {
    const { vaultPath, loadFiles, openFile } = get();
    if (!vaultPath) return;

    let targetFile = '';
    for (const p of paths) {
      const name = p.replace(/^.*[\\/]/, ''); 
      if (name.toLowerCase().endsWith('.docx')) {
        const info = await get().convertDocx(p, vaultPath);
        if (info) targetFile = info.path;
      } else if (name.toLowerCase().match(/\.(png|jpe?g|gif|webp|mp4|webm|mov|pdf)$/)) {
        const assetsDir = await join(vaultPath, 'assets');
        if (!await exists(assetsDir)) await mkdir(assetsDir);
        const targetPath = await join(assetsDir, name);
        if (p !== targetPath) {
          const contents = await readFile(p);
          await writeFile(targetPath, contents);
        }
        const relPath = await join('assets', name);
        get().setPendingAssetInserts([...get().pendingAssetInserts, relPath]);
        toast.success(`Imported media ${name}`);
      } else if (name.toLowerCase().endsWith('.md')) {
        const targetPath = await join(vaultPath, name);
        if (p !== targetPath) {
          const content = await readTextFile(p);
          await writeTextFile(targetPath, content);
          toast.success(`Imported ${name}`);
        }
        targetFile = targetPath;
      }
    }

    await loadFiles();
    if (targetFile) await openFile(targetFile);
  },

  refresh: async () => {
    set({ isRefreshing: true });
    const toastId = toast.loading('Refreshing vault...', { duration: 30000 });
    try {
      await get().loadFiles();
      await get().loadGraphData();
      toast.success('Vault refreshed', { id: toastId });
    } catch (e: any) {
      toast.error(`Refresh failed: ${e.message || e}`, { id: toastId, duration: 30000 });
    } finally {
      set({ isRefreshing: false });
    }
  },

  testToast: () => {
    toast.success('Notification System OK! ✅', { duration: 10000 });
  },
}));
