import { create } from 'zustand';
import { readDir, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

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

interface GraphData {
  nodes: { id: string; label: string }[];
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

  isSidebarOpen: boolean;
  graphData: GraphData;
  viewMode: 'editor' | 'graph';

  // ── Actions ──
  setVaultPath: (path: string) => Promise<void>;
  loadFiles: () => Promise<void>;

  openFile: (path: string) => Promise<void>;      // main open – adds tab + loads
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;

  createFile: (name: string, folderPath?: string) => Promise<void>;
  createFolder: (name: string, parentPath?: string) => Promise<void>;
  toggleFavorite: (path: string) => void;

  loadGraphData: (override?: { path: string; text: string }) => Promise<void>;
  setSidebarOpen: (v: boolean) => void;
  setViewMode: (mode: 'editor' | 'graph') => void;

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

export const useStore = create<AppState>((set, get) => ({
  vaultPath: null,
  files: [],
  allFiles: [],
  favorites: JSON.parse(localStorage.getItem('nopes_favorites') || '[]'),

  tabs: [],
  activeTab: null,
  tabContents: {},

  isSidebarOpen: true,
  graphData: { nodes: [], links: [] },
  viewMode: 'editor',

  activeContent: () => {
    const { activeTab, tabContents } = get();
    return activeTab ? (tabContents[activeTab] ?? '') : '';
  },

  setVaultPath: async (path) => {
    set({ vaultPath: path });
    await get().loadFiles();
    await get().loadGraphData();
  },

  loadFiles: async () => {
    const { vaultPath, favorites } = get();
    if (!vaultPath) return;

    const scanDir = async (dir: string): Promise<FileInfo[]> => {
      const entries = await readDir(dir);
      const result: FileInfo[] = [];
      for (const e of entries) {
        if (!e.name || e.name.startsWith('.')) continue;
        const fullPath = await join(dir, e.name);
        if (e.isDirectory) {
          result.push({ name: e.name, path: fullPath, is_dir: true, children: await scanDir(fullPath) });
        } else if (e.name.endsWith('.md')) {
          result.push({ name: e.name, path: fullPath, is_dir: false, isFavorite: favorites.includes(fullPath) });
        }
      }
      return result.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    };

    try {
      const tree = await scanDir(vaultPath);
      const flatten = (nodes: FileInfo[]): FileInfo[] =>
        nodes.reduce((acc, n) => {
          if (!n.is_dir) acc.push(n);
          if (n.children) acc.push(...flatten(n.children));
          return acc;
        }, [] as FileInfo[]);
      set({ files: tree, allFiles: flatten(tree) });
    } catch (e) { console.error('loadFiles error:', e); }
  },

  openFile: async (path) => {
    const { tabs, tabContents } = get();
    let content = tabContents[path];

    // load from disk if not already in memory
    if (content === undefined) {
      try { content = await readTextFile(path); } catch { content = ''; }
    }

    const label = path.split('/').pop()?.replace(/\.md$/, '') ?? 'Untitled';
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
      const initial = `# ${name.replace(/\.md$/, '')}\n\n`;
      await writeTextFile(newPath, initial);
      await get().loadFiles();
      await get().openFile(newPath);
    } catch (e) { console.error('createFile error:', e); }
  },

  createFolder: async (name, parentPath) => {
    const { vaultPath } = get();
    const base = parentPath || vaultPath;
    if (!base) return;
    try {
      await mkdir(await join(base, name));
      await get().loadFiles();
    } catch (e) { console.error('createFolder error:', e); }
  },

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
      const nodes = allFiles.map(f => ({ id: f.path, label: f.name.replace(/\.md$/, '') }));
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
      }
      set({ graphData: { nodes, links } });
    } catch (e) { console.error('Graph error:', e); }
  },

  setSidebarOpen: (v) => set({ isSidebarOpen: v }),
  setViewMode: (mode) => {
    set({ viewMode: mode });
    if (mode === 'graph') get().loadGraphData();
  },
}));
