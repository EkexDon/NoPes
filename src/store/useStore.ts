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
import { ThemeId, DEFAULT_THEME, isValidTheme, applyThemeToDom } from '../themes';
import { maybeSnapshotNote, moveHistory } from '../history';
import { VaultIndex, loadPersistedIndex, reconcileIndex, schedulePersist } from '../vaultIndex';
import { maybeGenerateDigest } from '../digest';
import { ClipPayload, buildClipNote, clipNoteName, getClipperToken } from '../clip';
import { healMediaEmbeds } from '../extensions/imageMarkdown';

/* The Vault Index — incremental extraction layer (tasks, tags, wikilinks,
   frontmatter) behind the Task Dashboard, digest, and future queries.
   Lives at module scope; views subscribe via the store's indexVersion. */
let vaultIndex = new VaultIndex();
let indexLoadedFor: string | null = null;
export function getVaultIndex(): VaultIndex { return vaultIndex; }
function touchIndex(set: (v: any) => void) {
  set((state: any) => ({ indexVersion: state.indexVersion + 1 }));
}

/* Resolve persisted theme and stamp it on <html> at module init,
   before first paint — prevents a default-theme flash. */
const storedTheme = localStorage.getItem('nopes_theme');
const initialTheme: ThemeId = isValidTheme(storedTheme) ? storedTheme : DEFAULT_THEME;
applyThemeToDom(initialTheme);

export async function scanDir(root: string, opts: { maxDepth: number; maxEntries: number; visited: Set<string> }, favorites: string[]): Promise<{ entries: FileInfo[]; truncated: boolean }> {
  if (opts.maxDepth <= 0 || opts.visited.size >= opts.maxEntries) return { entries: [], truncated: true };
  
  let canonical = root;
  try {
    canonical = root; // Tauri canonicalize might not be available, fallback to path tracking
  } catch {}

  if (opts.visited.has(canonical)) {
    console.warn('[scan] symlink cycle skipped', canonical);
    return { entries: [], truncated: false };
  }
  opts.visited.add(canonical);

  let dirEntries;
  try { dirEntries = await readDir(root); } catch { return { entries: [], truncated: false }; }

  const results: FileInfo[] = [];
  let truncated = false;

  for (const entry of dirEntries) {
    if (opts.visited.size >= opts.maxEntries) { truncated = true; break; }
    // Hidden/internal directories (.nopes history, .git, .obsidian, …)
    // are never part of the vault's visible tree.
    if (entry.name.startsWith('.')) continue;
    const fullPath = await join(root, entry.name);
    const info: FileInfo = {
      name: entry.name,
      path: fullPath,
      is_dir: entry.isDirectory,
      isFavorite: !!favorites?.includes(fullPath)
    };

    if (entry.isDirectory) {
      const childRes = await scanDir(fullPath, { maxDepth: opts.maxDepth - 1, maxEntries: opts.maxEntries, visited: opts.visited }, favorites);
      info.children = childRes.entries;
      if (childRes.truncated) truncated = true;
    }
    results.push(info);
  }

  return {
    entries: results.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    }),
    truncated
  };
}

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

export interface GraphData {
  nodes: { id: string; label: string; tags?: string[] }[];
  links: { source: string; target: string }[];
}

export interface AiIndexEntry {
  path: string;
  label: string;
  vec: Float32Array;
}

export interface NoteTemplate {
  id: string;
  name: string;
  content: string;
  category: string;
  createdAt: number;
}

export interface FileMetadata {
  icon?: string;
  iconType: 'emoji' | 'lucide' | 'image';
  color?: string;
  description?: string;
  lastOpened?: number;
  lastModified?: number;
  itemType: 'note' | 'canvas' | 'kanban' | 'folder';
}

export type ViewMode = 'editor' | 'graph' | 'journal' | 'canvas' | 'kanban' | 'home' | 'tasks' | 'review';

const MAX_AI_INDEX_ENTRIES = 10000;
const AI_INDEX_PRUNE_RATIO = 0.2;

interface AppState {
  vaultPath: string | null;
  files: FileInfo[];
  allFiles: FileInfo[];
  favorites: string[];

  // Multi-tab support
  tabs: Tab[];
  activeTab: string | null;
  tabContents: Record<string, string>; // path -> content
  tabContentsSize: () => { entries: number; bytes: number };
  setTabContents: (contents: Record<string, string>) => void;

  // Rich Media Assets awaiting insertion into the editor
  pendingAssetInserts: string[];
  // Media assets (images, videos) awaiting insertion
  media: MediaItem[];

  isSidebarOpen: boolean;
  isRefreshing: boolean;
  isAutoSaveEnabled: boolean;
  graphData: GraphData;
  /** bumped whenever the Vault Index changes — views recompute off it */
  indexVersion: number;
  viewMode: ViewMode;

  // Split View Multi-Pane Support
  isSplitView: boolean;
  rightActiveTab: string | null;
  rightViewMode: ViewMode;

  // File Metadata for Home Dashboard
  fileMetadata: Record<string, FileMetadata>;
  recentFiles: string[];
  setSplitView: (isSplit: boolean) => void;
  setRightActiveTab: (path: string | null) => void;
  setRightViewMode: (mode: ViewMode) => void;
  toggleSplitView: () => void;

  // Journal / Heatmap
  journalStats: Record<string, number>; // 'YYYY-MM-DD' -> word count

  // AI Toggle & Semantic Search
  isAiEnabled: boolean;
  aiIndex: AiIndexEntry[];
  aiApiKey: string | null;

  // Web Clipper
  isClipperEnabled: boolean;
  setClipperEnabled: (v: boolean) => Promise<void>;
  saveClip: (payload: ClipPayload) => Promise<void>;

  // Weekly AI digest
  isDigestEnabled: boolean;
  setDigestEnabled: (v: boolean) => void;
  runWeeklyDigest: () => Promise<void>;

  // Theme
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;

  // Fun Features
  zenMode: boolean;
  achievements: string[];
  setZenMode: (v: boolean) => void;
  unlockAchievement: (id: string, title: string) => void;

  // Templates
  templates: NoteTemplate[];
  saveTemplate: (template: Omit<NoteTemplate, 'id' | 'createdAt'>) => void;
  deleteTemplate: (id: string) => void;
  createFileFromTemplate: (name: string, templateId: string, folderPath?: string) => Promise<void>;
  insertTemplate: (templateId: string) => void;

  // Full-text search index
  searchIndex: Map<string, string>; // path -> content for search
  buildSearchIndex: () => Promise<void>;

  // File Metadata Actions
  setFileIcon: (path: string, icon: string, type: 'emoji' | 'lucide' | 'image') => void;
  setFileMetadata: (path: string, metadata: Partial<FileMetadata>) => void;
  updateRecentFile: (path: string) => void;
  loadFileMetadata: () => Promise<void>;
  saveFileMetadata: () => Promise<void>;
  detectFileType: (path: string, content?: string) => FileMetadata['itemType'];

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

  // Canvas & Kanban creation
  createCanvasFile: (name: string, folderPath?: string) => Promise<void>;
  createKanbanFile: (name: string, folderPath?: string) => Promise<void>;

  // Context Menu Helpers
  revealInFinder: (path: string) => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  duplicateFile: (path: string) => Promise<void>;
  moveItem: (sourcePath: string, targetDir: string) => Promise<void>;

  setPendingAssetInserts: (assets: string[]) => void;
  addMedia: (item: MediaItem) => void;

  loadGraphData: (override?: { path: string; text: string }) => Promise<void>;
  setSidebarOpen: (v: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  
  createNodeFromGraph: () => Promise<void>;
  computeJournalStats: () => Promise<void>;
  buildAiIndex: () => Promise<void>;
  loadAiIndex: () => Promise<void>;
  setAiApiKey: (key: string) => void;
  setAiEnabled: (v: boolean) => void;
  setAutoSaveEnabled: (v: boolean) => void;
  clearAiIndex: () => void;

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

/** Enforces LRU on tabContents to prevent unbounded memory growth (L-05) */
export function enforceTabContentsLRU(
  contents: Record<string, string>,
  activePaths: string[],
  maxEntries = 64,
  maxBytes = 32 * 1024 * 1024
): Record<string, string> {
  const keys = Object.keys(contents);
  const totalBytes = () => keys.reduce((acc, k) => acc + (contents[k]?.length || 0), 0);

  if (keys.length <= maxEntries && totalBytes() <= maxBytes) return contents;

  const next = { ...contents };
  let currentEntries = keys.length;
  let currentBytes = totalBytes();

  // Evict oldest first (Object.keys insertion order)
  for (const key of keys) {
    if (currentEntries <= maxEntries && currentBytes <= maxBytes) break;
    if (activePaths.includes(key)) continue; // Never evict active tabs
    if (currentEntries <= 1) break; // Always retain at least one entry (the most recent)

    if (next[key]) {
      currentBytes -= next[key].length;
      delete next[key];
      currentEntries--;
    }
  }
  return next;
}

function deriveLabelFromPath(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? 'Note';
}

function normalizeAiVec(vec: unknown): Float32Array | null {
  if (vec instanceof Float32Array) return vec;
  if (!Array.isArray(vec)) return null;
  if (!vec.length) return null;
  if (vec.length > 4096) return null; // defensive upper bound
  const nums: number[] = [];
  for (const v of vec) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    nums.push(v);
  }
  return new Float32Array(nums);
}

export function sanitizeAiIndex(raw: unknown, maxEntries = MAX_AI_INDEX_ENTRIES): AiIndexEntry[] {
  if (!Array.isArray(raw) || maxEntries <= 0) return [];
  const seen = new Set<string>();
  const out: AiIndexEntry[] = [];

  // Iterate from end to keep newest entries first when deduping.
  for (let i = raw.length - 1; i >= 0; i--) {
    const item = raw[i] as Partial<AiIndexEntry> | null | undefined;
    const path = typeof item?.path === 'string' ? item.path : '';
    if (!path || seen.has(path)) continue;
    const vec = normalizeAiVec(item?.vec);
    if (!vec) continue;
    seen.add(path);
    out.push({
      path,
      label: typeof item?.label === 'string' && item.label ? item.label : deriveLabelFromPath(path),
      vec,
    });
    if (out.length >= maxEntries) break;
  }

  return out.reverse();
}

export function mergeAiIndex(
  existing: AiIndexEntry[],
  incoming: AiIndexEntry[],
  maxEntries = MAX_AI_INDEX_ENTRIES,
  pruneRatio = AI_INDEX_PRUNE_RATIO
): { index: AiIndexEntry[]; pruned: boolean } {
  const map = new Map<string, AiIndexEntry>();
  const push = (item: AiIndexEntry) => {
    if (map.has(item.path)) map.delete(item.path);
    map.set(item.path, item);
  };

  existing.forEach(push);
  incoming.forEach(push);

  let merged = Array.from(map.values());
  let pruned = false;
  if (merged.length > maxEntries) {
    pruned = true;
    const pruneCount = Math.max(1, Math.floor(merged.length * pruneRatio));
    merged = merged.slice(pruneCount);
    if (merged.length > maxEntries) merged = merged.slice(-maxEntries);
  }
  return { index: merged, pruned };
}

export function applyGraphOverride(
  currentGraph: GraphData,
  allFiles: FileInfo[],
  override: { path: string; text: string }
): GraphData {
  const endpointId = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
      const id = (v as Record<string, unknown>).id;
      return typeof id === 'string' ? id : '';
    }
    return '';
  };
  const validPaths = new Set(allFiles.filter(f => !f.is_dir).map(f => f.path));
  const byLabel = new Map(
    allFiles
      .filter(f => !f.is_dir)
      .map(f => [f.name.replace(/\.md$/, '').toLowerCase(), f.path] as const)
  );

  const links = currentGraph.links
    .map(link => ({ source: endpointId((link as any).source), target: endpointId((link as any).target) }))
    .filter(link => link.source && link.target)
    .filter(link => link.source !== override.path)
    .filter(link => validPaths.has(link.source) && validPaths.has(link.target));

  for (const target of extractWikilinks(override.text)) {
    const targetPath = byLabel.get(target.toLowerCase());
    if (targetPath && targetPath !== override.path) {
      links.push({ source: override.path, target: targetPath });
    }
  }

  const nodes = currentGraph.nodes.filter(node => node.id !== override.path && validPaths.has(node.id));
  if (validPaths.has(override.path)) {
    const file = allFiles.find(f => f.path === override.path);
    nodes.push({
      id: override.path,
      label: file?.name.replace(/\.md$/, '') ?? deriveLabelFromPath(override.path),
      tags: extractTags(override.text),
    });
  }

  return { nodes, links };
}


/* Find a free path in `dir` for `fileName` — appends " 2", " 3", …
   before the extension instead of silently overwriting. */
async function uniquePath(dir: string, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let candidate = await join(dir, fileName);
  for (let i = 2; await exists(candidate); i++) {
    candidate = await join(dir, `${stem} ${i}${ext}`);
  }
  return candidate;
}

export const useStore = create<AppState>((set, get) => ({
  vaultPath: localStorage.getItem('nopes_vault_path'),
  files: [],
  allFiles: [],
  favorites: JSON.parse(localStorage.getItem('nopes_favorites') || '[]'),

  tabs: [],
  activeTab: null,
  tabContents: {},
  tabContentsSize: () => {
    const { tabContents } = get();
    const entries = Object.keys(tabContents);
    return {
      entries: entries.length,
      bytes: entries.reduce((acc, k) => acc + (tabContents[k]?.length || 0), 0)
    };
  },
  setTabContents: (contents) => set({ tabContents: contents }),
  pendingAssetInserts: [],
  media: [],

  isSidebarOpen: true,
  isRefreshing: false,
  isAutoSaveEnabled: localStorage.getItem('nopes_autosave_enabled') !== 'false', // default true
  graphData: { nodes: [], links: [] },
  indexVersion: 0,
  viewMode: 'editor',
  isSplitView: false,
  rightActiveTab: null,
  rightViewMode: 'graph',
  journalStats: {},
  isAiEnabled: localStorage.getItem('nopes_ai_enabled') !== 'false', // default true
  aiIndex: [],
  aiApiKey: localStorage.getItem('nopes_ai_key'),

  isClipperEnabled: localStorage.getItem('nopes_clipper_enabled') === 'true', // OFF by default (attack surface)
  setClipperEnabled: async (v) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_clipper', { enabled: v, token: getClipperToken() });
      localStorage.setItem('nopes_clipper_enabled', String(v));
      set({ isClipperEnabled: v });
      if (v) toast.success('Web Clipper listening on 127.0.0.1:21787');
      else toast('Web Clipper stopped', { icon: '🔌' });
    } catch (e: any) {
      toast.error(`Clipper: ${e?.message ?? e}`);
    }
  },
  saveClip: async (payload) => {
    const { vaultPath } = get();
    if (!vaultPath) return;
    try {
      const clipsDir = await join(vaultPath, 'Clips');
      if (!(await exists(clipsDir))) await mkdir(clipsDir);
      const path = await uniquePath(clipsDir, clipNoteName(payload.title, new Date()));
      await writeTextFile(path, buildClipNote(payload, new Date()));
      toast.success(`Clipped: ${payload.title ?? 'page'}`, { duration: 4000 });
      await get().loadFiles();
    } catch (e: any) {
      toast.error(`Clip failed: ${e?.message ?? e}`);
    }
  },

  isDigestEnabled: localStorage.getItem('nopes_digest_enabled') !== 'false', // default on
  setDigestEnabled: (v) => {
    localStorage.setItem('nopes_digest_enabled', String(v));
    set({ isDigestEnabled: v });
  },
  runWeeklyDigest: async () => {
    const { vaultPath, isAiEnabled, isDigestEnabled } = get();
    if (!vaultPath || !isAiEnabled || !isDigestEnabled) return;
    try {
      await get().computeJournalStats();
      const created = await maybeGenerateDigest({
        vaultPath,
        notesModifiedBetween: (from, to) =>
          vaultIndex.allNotes()
            .filter(n => n.mtime >= from && n.mtime <= to && !/^Your Week — /.test(n.path.split(/[/\\]/).pop() ?? ''))
            .map(n => ({
              name: n.path.split(/[/\\]/).pop()?.replace(/\.md$/, '') ?? 'Note',
              wordCount: n.wordCount,
              tags: n.tags,
            })),
        journalStats: get().journalStats,
        openTasks: vaultIndex.allTasks().filter(t => !t.checked).length,
      });
      if (created) {
        toast('📩 Your Week is ready — check your vault', { duration: 6000, icon: '🗞️' });
        await get().loadFiles();
      }
    } catch (e) { console.warn('[NoPes:digest] Generation failed:', e); }
  },

  theme: initialTheme,
  setTheme: (id) => {
    localStorage.setItem('nopes_theme', id);
    applyThemeToDom(id);
    set({ theme: id });
  },

  zenMode: false,
  achievements: JSON.parse(localStorage.getItem('nopes_achievements') || '[]'),
  templates: JSON.parse(localStorage.getItem('nopes_templates') || '[]'),
  searchIndex: new Map(),
  // Loaded eagerly — this is what remembers which files are canvas/kanban
  // boards; without it every reload demoted them to plain notes.
  fileMetadata: (() => {
    try { return JSON.parse(localStorage.getItem('nopes_file_metadata') || '{}'); }
    catch { return {}; }
  })(),
  recentFiles: JSON.parse(localStorage.getItem('nopes_recent_files') || '[]'),

  setZenMode: (v) => set({ zenMode: v }),
  unlockAchievement: (id, title) => {
    const { achievements } = get();
    if (!achievements.includes(id)) {
      const next = [...achievements, id];
      set({ achievements: next });
      localStorage.setItem('nopes_achievements', JSON.stringify(next));
      toast.success(`🏆 Achievement Unlocked: ${title}`, {
        duration: 4000,
        style: { background: 'var(--accent)', color: 'var(--accent-contrast)' }
      });
    }
  },

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
    get().clearAiIndex(); // Purge prior vault's embeddings (L-06)
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
      const { entries: rawScanResult, truncated } = await scanDir(vaultPath, { maxDepth: 12, maxEntries: 20000, visited: new Set() }, favorites);
      if (truncated) console.warn('Scan truncated due to maxDepth or maxEntries limits.');
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

      // Vault Index: load persisted index once per vault, then reconcile
      // in the background (reads only new/changed files).
      (async () => {
        try {
          if (indexLoadedFor !== vaultPath) {
            vaultIndex = await loadPersistedIndex(vaultPath);
            indexLoadedFor = vaultPath;
          }
          await reconcileIndex(vaultPath, vaultIndex, filteredFlatList);
          // ALWAYS bump: an early autosave can raise indexVersion before
          // this reconcile finishes — a conditional bump here left views
          // (Review!) showing the pre-index snapshot until the next save.
          touchIndex(set);
        } catch (e) { console.warn('[NoPes:index] Reconcile failed:', e); }
      })();
      
      // Load AI index from cache if it exists, otherwise build it lazily (if enabled)
      if (get().isAiEnabled) {
        await get().loadAiIndex();
      }
      
      // Auto-convert any docx found in the scan — skip the archive
      // folder or every refresh re-converts already-processed docs.
      for (const f of fullFlatList) {
        if (f.path.includes('_word_archive')) continue;
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
      // Heal damaged media embeds (bracket-escaped corpses, raw spaces in
      // destinations) so the editor re-renders them as real embeds.
      if (path.toLowerCase().endsWith('.md') && content) {
        const healed = healMediaEmbeds(content);
        if (healed !== content) {
          content = healed;
          get().saveFile(path, healed); // persist the repair (snapshots first)
        }
      }
    }

    const name = await basename(path);
    const label = name.replace(/\.md$/, '') || 'Untitled';
    const alreadyOpen = tabs.some(t => t.path === path);

    // Detect view mode from content markers - ONLY explicit markers
    let targetViewMode: ViewMode = 'editor';
    const contentToCheck = content || '';

    // Strict check - only explicit HTML markers
    if (contentToCheck.includes('<!-- CANVAS -->') ||
        contentToCheck.includes('data-canvas="true"')) {
      targetViewMode = 'canvas';
    } else if (contentToCheck.includes('<!-- KANBAN -->') ||
               contentToCheck.includes('data-kanban="true"')) {
      targetViewMode = 'kanban';
    }

    // Persisted metadata as fallback: the editor round-trip strips HTML
    // comments, so the marker can be missing from a board file. Metadata
    // remembers what the file really is.
    const knownType = get().fileMetadata[path]?.itemType;
    if (targetViewMode === 'editor' && (knownType === 'canvas' || knownType === 'kanban')) {
      targetViewMode = knownType;
    } else if (targetViewMode !== 'editor' && knownType !== targetViewMode) {
      // Marker present but metadata missing/stale — record it.
      get().setFileMetadata(path, { itemType: targetViewMode as 'canvas' | 'kanban' });
    }

    set(state => {
      const activePaths = state.tabs.map(t => t.path);
      if (path && !activePaths.includes(path)) activePaths.push(path);
      
      const newContents = enforceTabContentsLRU(
        { ...state.tabContents, [path]: content! },
        activePaths
      );

      return {
        tabs: alreadyOpen ? state.tabs : [...state.tabs, { path, label }],
        tabContents: newContents,
        activeTab: path,
        viewMode: targetViewMode,
      };
    });

    // Update recent files list
    get().updateRecentFile(path);
    
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

  setActiveTab: (path) => {
    // Board files open in their board view, not the raw editor — editing
    // a canvas/kanban .md as text destroys its marker.
    const { tabContents, fileMetadata } = get();
    const c = tabContents[path] ?? '';
    const t = fileMetadata[path]?.itemType;
    const viewMode: ViewMode =
      c.includes('<!-- CANVAS -->') || c.includes('data-canvas="true"') || t === 'canvas' ? 'canvas' :
      c.includes('<!-- KANBAN -->') || c.includes('data-kanban="true"') || t === 'kanban' ? 'kanban' :
      'editor';
    set({ activeTab: path, viewMode });
  },

  saveFile: async (path, content) => {
    // Self-heal board markers: TipTap drops HTML comments, so a board
    // file saved through the editor would silently lose its identity.
    const itemType = get().fileMetadata[path]?.itemType;
    if (itemType === 'canvas' && !content.includes('<!-- CANVAS -->') && !content.includes('data-canvas="true"')) {
      content = '<!-- CANVAS -->\n\n' + content;
    } else if (itemType === 'kanban' && !content.includes('<!-- KANBAN -->') && !content.includes('data-kanban="true"')) {
      content = '<!-- KANBAN -->\n\n' + content;
    }
    try {
      // Version history: preserve the state we're about to overwrite
      // (rate-limited to one snapshot per note per minute).
      await maybeSnapshotNote(get().vaultPath, path);
      await writeTextFile(path, content);
      set(state => {
        const activePaths = state.tabs.map(t => t.path);
        const newContents = enforceTabContentsLRU(
          { ...state.tabContents, [path]: content },
          activePaths
        );
        return { tabContents: newContents };
      });
      await get().loadGraphData({ path, text: content });

      // Keep the Vault Index in lockstep with every save
      if (path.toLowerCase().endsWith('.md')) {
        vaultIndex.updateNote(path, content);
        const vp = get().vaultPath;
        if (vp) schedulePersist(vp, vaultIndex);
        touchIndex(set);
      }
    } catch (e: any) { 
      console.error('saveFile error:', e); 
      toast.error('Save failed: ' + (e.message || e));
    }
  },

  createFile: async (name, folderPath) => {
    const { vaultPath } = get();
    const base = folderPath || vaultPath;
    if (!base) return;
    try {
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const newPath = await uniquePath(base, fileName);
      await writeTextFile(newPath, '# ' + name);
      await get().loadFiles();
      await get().openFile(newPath);
      const noteCount = get().allFiles.filter(f => !f.is_dir).length;
      get().unlockAchievement('first-note', 'First Note');
      if (noteCount >= 10) get().unlockAchievement('architect-10', 'Architect');
      if (noteCount >= 50) get().unlockAchievement('librarian-50', 'Librarian');
    } catch (e) { console.error('createFile error:', e); }
  },

  saveTemplate: (template) => {
    const { templates } = get();
    const newTemplate: NoteTemplate = {
      ...template,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const next = [...templates, newTemplate];
    set({ templates: next });
    localStorage.setItem('nopes_templates', JSON.stringify(next));
    toast.success(`Template "${template.name}" saved`);
  },

  deleteTemplate: (id) => {
    const { templates } = get();
    const next = templates.filter(t => t.id !== id);
    set({ templates: next });
    localStorage.setItem('nopes_templates', JSON.stringify(next));
    toast.success('Template deleted');
  },

  createFileFromTemplate: async (name, templateId, folderPath) => {
    const { vaultPath, templates } = get();
    const base = folderPath || vaultPath;
    if (!base) return;
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      toast.error('Template not found');
      return;
    }
    try {
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const newPath = await uniquePath(base, fileName);
      const content = template.content.replace(/\$\{name\}/g, name.replace(/\.md$/, ''));
      await writeTextFile(newPath, content);
      await get().loadFiles();
      await get().openFile(newPath);
      const noteCount = get().allFiles.filter(f => !f.is_dir).length;
      get().unlockAchievement('first-note', 'First Note');
      if (noteCount >= 10) get().unlockAchievement('architect-10', 'Architect');
      if (noteCount >= 50) get().unlockAchievement('librarian-50', 'Librarian');
      toast.success(`Created from template "${template.name}"`);
    } catch (e) { console.error('createFileFromTemplate error:', e); }
  },

  insertTemplate: (templateId) => {
    const { templates, activeTab, tabContents } = get();
    if (!activeTab) {
      toast.error('No active file to insert template');
      return;
    }
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      toast.error('Template not found');
      return;
    }
    const currentContent = tabContents[activeTab] ?? '';
    // Insert at end with a newline separator
    const newContent = currentContent + (currentContent ? '\n\n' : '') + template.content;
    // Persist immediately — the editor syncs this without emitting an
    // update, so autosave would never fire for it.
    get().saveFile(activeTab, newContent);
    toast.success(`Template "${template.name}" inserted`);
  },

  createCanvasFile: async (name, folderPath) => {
    const { vaultPath, setFileMetadata } = get();
    const base = folderPath || vaultPath;
    if (!base) return;
    try {
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const newPath = await uniquePath(base, fileName);
      const content = `<!-- CANVAS -->

# ${name.replace(/\.md$/, '')}

This is a canvas board.
`;
      await writeTextFile(newPath, content);
      
      // Set metadata for canvas type
      setFileMetadata(newPath, {
        itemType: 'canvas',
        iconType: 'emoji',
        icon: '🎨'
      });
      
      await get().loadFiles();
      await get().openFile(newPath);
      // Small delay to ensure openFile state update completes before setting viewMode
      setTimeout(() => get().setViewMode('canvas'), 50);
      toast.success('Canvas created');
    } catch (e) { console.error('createCanvasFile error:', e); }
  },

  createKanbanFile: async (name, folderPath) => {
    const { vaultPath, setFileMetadata } = get();
    const base = folderPath || vaultPath;
    if (!base) return;
    try {
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const newPath = await uniquePath(base, fileName);
      const content = `<!-- KANBAN -->

# ${name.replace(/\.md$/, '')}

## 📋 To Do
- [ ] Task 1
- [ ] Task 2

## 🔄 In Progress

## ✅ Done
- [x] Started project
`;
      await writeTextFile(newPath, content);
      
      // Set metadata for kanban type
      setFileMetadata(newPath, {
        itemType: 'kanban',
        iconType: 'emoji',
        icon: '📊'
      });
      
      await get().loadFiles();
      await get().openFile(newPath);
      // Small delay to ensure openFile state update completes before setting viewMode
      setTimeout(() => get().setViewMode('kanban'), 50);
      toast.success('Kanban board created');
    } catch (e) { console.error('createKanbanFile error:', e); }
  },

  revealInFinder: async (path) => {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(await dirname(path));
      toast.success('Opened in Finder');
    } catch (e: any) {
      console.error('revealInFinder error:', e);
      toast.error(`Could not open: ${e.message || e}`);
    }
  },

  copyToClipboard: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch (e: any) {
      console.error('copyToClipboard error:', e);
      toast.error('Failed to copy');
    }
  },

  duplicateFile: async (path) => {
    try {
      const content = await readTextFile(path);
      const baseName = await basename(path);
      const nameWithoutExt = baseName.replace(/\.md$/, '');
      const dir = await dirname(path);
      const newPath = await uniquePath(dir, `${nameWithoutExt} Copy.md`);

      await writeTextFile(newPath, content);
      await get().loadFiles();
      toast.success('File duplicated');
    } catch (e: any) {
      console.error('duplicateFile error:', e);
      toast.error(`Duplicate failed: ${e.message || e}`);
    }
  },

  moveItem: async (sourcePath: string, targetDir: string) => {
    try {
      const { rename, exists } = await import('@tauri-apps/plugin-fs');
      const { basename, join } = await import('@tauri-apps/api/path');

      const fileName = await basename(sourcePath);
      const newPath = await join(targetDir, fileName);

      // Don't move if already in target
      if (sourcePath === newPath) return;

      // Check if target already exists — window.prompt doesn't work in
      // Tauri's WebView, so resolve the conflict with a unique name.
      const targetExists = await exists(newPath);
      if (targetExists) {
        const finalPath = await uniquePath(targetDir, fileName);
        const newFileName = await basename(finalPath);
        await rename(sourcePath, finalPath);
        if (sourcePath.toLowerCase().endsWith('.md')) {
          await moveHistory(get().vaultPath, sourcePath, finalPath);
          vaultIndex.renameNote(sourcePath, finalPath);
          touchIndex(set);
        }

        // Update tabs if file was open
        const { tabs, tabContents, activeTab } = get();
        const wasOpen = tabs.some(t => t.path === sourcePath);

        if (wasOpen) {
          const newTabs = tabs.map(t =>
            t.path === sourcePath ? { ...t, path: finalPath, label: newFileName.replace(/\.md$/, '') } : t
          );
          const newTabContents = { ...tabContents };
          if (newTabContents[sourcePath] !== undefined) {
            newTabContents[finalPath] = newTabContents[sourcePath];
            delete newTabContents[sourcePath];
          }
          const newActive = activeTab === sourcePath ? finalPath : activeTab;
          set({ tabs: newTabs, tabContents: newTabContents, activeTab: newActive });
        }

        toast.success(`Moved as "${newFileName}"`);
        await get().loadFiles();
        await get().loadGraphData();
        return;
      }

      await rename(sourcePath, newPath);
      if (sourcePath.toLowerCase().endsWith('.md')) {
        await moveHistory(get().vaultPath, sourcePath, newPath);
        vaultIndex.renameNote(sourcePath, newPath);
        touchIndex(set);
      }

      // Update tabs if file was open
      const { tabs, tabContents, activeTab } = get();
      const wasOpen = tabs.some(t => t.path === sourcePath);

      if (wasOpen) {
        const newTabs = tabs.map(t =>
          t.path === sourcePath ? { ...t, path: newPath, label: fileName.replace(/\.md$/, '') } : t
        );
        const newTabContents = { ...tabContents };
        if (newTabContents[sourcePath] !== undefined) {
          newTabContents[newPath] = newTabContents[sourcePath];
          delete newTabContents[sourcePath];
        }
        const newActive = activeTab === sourcePath ? newPath : activeTab;
        set({ tabs: newTabs, tabContents: newTabContents, activeTab: newActive });
      }

      await get().loadFiles();
      await get().loadGraphData();
      toast.success(`Moved to ${fileName}`);
    } catch (e: any) {
      console.error('moveItem error:', e);
      toast.error(`Failed to move: ${e.message || e}`);
    }
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
      // Deleting a note is the riskiest operation there is — force a
      // snapshot first so it's recoverable from Version History.
      if (path.toLowerCase().endsWith('.md')) {
        await maybeSnapshotNote(get().vaultPath, path, { force: true });
      }
      await remove(path, { recursive: true });
      vaultIndex.removeNote(path);
      const vpDel = get().vaultPath;
      if (vpDel) schedulePersist(vpDel, vaultIndex);
      touchIndex(set);
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
      let finalName = newName.endsWith('.md') || !isMd ? newName : `${newName}.md`;
      const newPath = await join(dir, finalName);
      if (newPath === oldPath) return; // No change
      if (await exists(newPath)) {
        toast.error(`"${finalName}" already exists`);
        return;
      }

      // Get current state BEFORE rename
      const { tabs, tabContents, activeTab, allFiles } = get();

      await rename(oldPath, newPath);
      if (isMd) {
        await moveHistory(get().vaultPath, oldPath, newPath);
        vaultIndex.renameNote(oldPath, newPath);
        touchIndex(set);
      }
      
      const oldBase = oldPath.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? '';
      const newBase = finalName.replace(/\.md$/, '');
      
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
      
      // Write changes to all modified files and update state
      const activePaths = tabs.map(t => t.path);
      const finalContents = enforceTabContentsLRU(newTabContents, activePaths);
      
      set({ tabs: newTabs, activeTab: newActive, tabContents: finalContents });
      
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
    const { allFiles, viewMode, graphData } = get();
    if (!allFiles.length) return;

    // In editor mode, avoid full-vault rescans on every autosave.
    // If graph was previously built, patch just the changed note.
    if (override && viewMode !== 'graph' && graphData.nodes.length > 0) {
      set({ graphData: applyGraphOverride(graphData, allFiles, override) });
      return;
    }

    // If not in graph view and no prior graph cache exists, skip.
    if (viewMode !== 'graph' && !override) return;

    try {
      const nodes: { id: string; label: string; tags: string[] }[] = [];
      const links: { source: string; target: string }[] = [];
      const byLabel = new Map(allFiles.map(f => [f.name.replace(/\.md$/, '').toLowerCase(), f.path]));
      const { tabContents } = get();

      for (const file of allFiles) {
        let text = '';
        if (override && file.path === override.path) {
          text = override.text;
        } else {
          text = tabContents[file.path] ?? '';
          if (!text) {
            // Only read from disk if absolutely necessary (this is the expensive part)
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
    const { allFiles, tabContents, vaultPath, isAiEnabled } = get();
    if (!vaultPath || !isAiEnabled) return;

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
      toast.loading('Building AI index (this may take a minute)...', { id: 'ai-index' });
      const results = await AIService.embedDocs(docsToEmbed);
      
      const newItems = results.map(r => ({
        path: r.path,
        label: r.path.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? 'Note',
        vec: r.vec
      }));

      let wasPruned = false;
      set(state => {
        const merged = mergeAiIndex(state.aiIndex, sanitizeAiIndex(newItems, MAX_AI_INDEX_ENTRIES));
        wasPruned = merged.pruned;
        return { aiIndex: merged.index };
      });
      if (wasPruned) {
        console.warn('[AI] Embedding cap reached. Pruning oldest entries.');
      }
      
      const { aiIndex } = get();
      // Save to cache
      const cachePath = await join(vaultPath, '.nopes_embeddings.json');
      // Convert Float32Array to regular array for JSON serialization
      const serializableIndex = aiIndex.map(item => ({
        ...item,
        vec: Array.from(item.vec)
      }));
      await writeTextFile(cachePath, JSON.stringify(serializableIndex));
      
      toast.success('AI index built and cached', { id: 'ai-index' });
    } catch (err) {
      console.error('Failed to build AI index:', err);
      toast.error('Failed to build AI index', { id: 'ai-index' });
    }
  },

  loadAiIndex: async () => {
    const { vaultPath } = get();
    if (!vaultPath) return;
    const cachePath = await join(vaultPath, '.nopes_embeddings.json');
    
    if (await exists(cachePath)) {
      try {
        const content = await readTextFile(cachePath);
        const data = JSON.parse(content) as unknown;
        const restoredIndex = sanitizeAiIndex(data, MAX_AI_INDEX_ENTRIES);
        set({ aiIndex: restoredIndex });
        console.log('[Store] AI index restored from cache');
      } catch (e) {
        console.warn('Failed to load AI index cache:', e);
      }
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
        let targetPath = await join(assetsDir, name);
        let finalName = name;
        if (p !== targetPath) {
          targetPath = await uniquePath(assetsDir, name);
          finalName = await basename(targetPath);
          const contents = await readFile(p);
          await writeFile(targetPath, contents);
        }
        const relPath = await join('assets', finalName);
        get().setPendingAssetInserts([...get().pendingAssetInserts, relPath]);
        toast.success(`Imported media ${name}`);
      } else if (name.toLowerCase().endsWith('.md')) {
        let targetPath = await join(vaultPath, name);
        if (p !== targetPath) {
          targetPath = await uniquePath(vaultPath, name);
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

  setAiEnabled: (v) => {
    localStorage.setItem('nopes_ai_enabled', String(v));
    set({ isAiEnabled: v });
    import('@tauri-apps/api/core').then(m => {
       m.invoke('manage_ollama', { active: v }).catch(console.error);
    });
    if (!v) {
       set({ aiIndex: [] }); // Clear memory
       AIService.terminate(); // Kill the worker thread
    } else {
       get().loadAiIndex(); // Restore if turned back on
    }
  },

  setAutoSaveEnabled: (v) => {
    localStorage.setItem('nopes_autosave_enabled', String(v));
    set({ isAutoSaveEnabled: v });
  },

  testToast: () => {
    toast.success('Notification System OK! ✅', { duration: 10000 });
  },

  clearAiIndex: () => {
    // Reassign to empty to allow GC of large Float32Arrays (L-06)
    set({ aiIndex: [] });
  },

  buildSearchIndex: async () => {
    const { allFiles, tabContents } = get();
    const index = new Map<string, string>();
    
    for (const f of allFiles) {
      if (f.is_dir || !f.name.endsWith('.md')) continue;
      let text = tabContents[f.path];
      if (!text) {
        try { text = await readTextFile(f.path); } catch { continue; }
      }
      index.set(f.path, text);
    }
    
    set({ searchIndex: index });
    console.log('[Store] Full-text search index built:', index.size, 'notes');
  },

  // File Metadata Management
  detectFileType: (path: string, content?: string): FileMetadata['itemType'] => {
    if (!path) return 'note';
    
    // Check for canvas marker in content
    if (content?.includes('<!-- CANVAS -->') || content?.includes('data-canvas="true"')) {
      return 'canvas';
    }
    
    // Check for kanban marker in content  
    if (content?.includes('<!-- KANBAN -->') || content?.includes('data-kanban="true"')) {
      return 'kanban';
    }
    
    // Check file extension
    if (path.toLowerCase().endsWith('.md')) {
      return 'note';
    }
    
    return 'note';
  },

  setFileIcon: (path: string, icon: string, type: 'emoji' | 'lucide' | 'image') => {
    const { fileMetadata, detectFileType } = get();
    const existing = fileMetadata[path] || {
      iconType: type,
      itemType: detectFileType(path)
    };
    
    const next = {
      ...fileMetadata,
      [path]: {
        ...existing,
        icon,
        iconType: type,
        lastModified: Date.now()
      }
    };
    
    set({ fileMetadata: next });
    localStorage.setItem('nopes_file_metadata', JSON.stringify(next));
    toast.success('Icon updated');
  },

  setFileMetadata: (path: string, metadata: Partial<FileMetadata>) => {
    const { fileMetadata } = get();
    const existing = fileMetadata[path] || { iconType: 'emoji', itemType: 'note' };
    
    const next = {
      ...fileMetadata,
      [path]: {
        ...existing,
        ...metadata,
        lastModified: Date.now()
      }
    };
    
    set({ fileMetadata: next });
    localStorage.setItem('nopes_file_metadata', JSON.stringify(next));
  },

  updateRecentFile: (path: string) => {
    const { recentFiles } = get();
    const next = [path, ...recentFiles.filter(p => p !== path)].slice(0, 10);
    set({ recentFiles: next });
    localStorage.setItem('nopes_recent_files', JSON.stringify(next));
    
    // Also update lastOpened in metadata
    const { fileMetadata, detectFileType, setFileMetadata, tabContents } = get();
    if (!fileMetadata[path]) {
      setFileMetadata(path, {
        // pass content — without it detection always answers 'note'
        itemType: detectFileType(path, tabContents[path]),
        iconType: 'emoji',
        lastOpened: Date.now()
      });
    } else {
      setFileMetadata(path, { lastOpened: Date.now() });
    }
  },

  loadFileMetadata: async () => {
    try {
      const stored = localStorage.getItem('nopes_file_metadata');
      if (stored) {
        const parsed = JSON.parse(stored);
        set({ fileMetadata: parsed });
      }
    } catch (e) {
      console.error('Failed to load file metadata:', e);
    }
  },

  saveFileMetadata: async () => {
    const { fileMetadata } = get();
    try {
      localStorage.setItem('nopes_file_metadata', JSON.stringify(fileMetadata));
    } catch (e) {
      console.error('Failed to save file metadata:', e);
    }
  },
}));
