import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEditor, EditorContent, ReactRenderer, Extension, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';
import { Markdown } from 'tiptap-markdown';
import tippy, { Instance, delegate } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { MathExtension } from '@aarkue/tiptap-math-extension';
import 'katex/dist/katex.min.css';

// Custom FontSize extension that properly handles font-size styling
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, ''),
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }) => {
        return chain().setMark('textStyle', { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }) => {
        return chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
      },
    };
  },
});
import { FoldingExtension } from '../extensions/FoldingExtension';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import html2pdf from 'html2pdf.js';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, Link as LinkIcon,
  Image as ImageIcon, List, ListOrdered, Quote, Code, MoreHorizontal,
  Minus, FileText, Underline as UnderlineIcon, Palette, Sparkles, Hash, Trash2,
  Search, X as XIcon, ChevronUp, ChevronDown,
  Grid3x3, LayoutTemplate, GitBranch, CheckSquare,
  RowsIcon, Columns, Trash, TableIcon, ChevronLeft, ChevronRight, Printer, Focus, History
} from 'lucide-react';
import { HistoryModal } from './HistoryModal';
import { useStore, extractTags } from '../store/useStore';
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { AIService } from '../workers/AIService';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { disposeEditorInstance } from './editorLifecycle';
import { isDarkTheme } from '../themes';
import { findUnlinkedMentions, linkMentions } from '../mentions';
import { MermaidNode } from '../extensions/MermaidNode';
import { QueryBlockNode } from '../extensions/QueryBlock';
import { runQuery, noteName as queryNoteName } from '../queryEngine';
import { getVaultIndex } from '../store/useStore';
import { filterLinkSuggestions, loadDismissed, addDismissed, LinkSuggestion } from '../linkSuggestions';
import { VoiceMemoButton } from './VoiceMemo';
import { recognizeImage } from '../ocr';
import { prepareCloneForPdf, bytesToDataUrl } from '../exportUtils';
import { safeDecodeSrc, encodeMediaSrc, sanitizeImportFileName } from '../extensions/imageMarkdown';

const COMBO_RESET_MS = 2000;

// Lazy init mermaid — re-initialized whenever the app theme flips
// between dark and light so new renders match the active theme.
let mermaidInstance: any = null;
let mermaidDark: boolean | null = null;
const initMermaid = async () => {
  const dark = isDarkTheme(useStore.getState().theme);
  if (!mermaidInstance) {
    const m = await import('mermaid');
    mermaidInstance = m.default || m;
  }
  if (mermaidDark !== dark) {
    mermaidDark = dark;
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      darkMode: dark,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 14,
    });
  }
  return mermaidInstance;
};

/* ─────────────────────────────────────────────
   Resolve a stored relative path (e.g. "assets/foo.mp4")
   to a playable asset:// URL for the Tauri WebView
────────────────────────────────────────────── */
const resolveAssetSrc = (relPath: string): string => {
  if (!relPath) return '';
  if (relPath.startsWith('http') || relPath.startsWith('data:') || relPath.startsWith('asset://')) {
    return relPath;
  }
  const vault = useStore.getState().vaultPath;
  if (!vault) return relPath;
  const sep = vault.includes('\\') ? '\\' : '/';
  const absPath = `${vault}${sep}${relPath}`;
  try {
    return convertFileSrc(absPath);
  } catch (e) {
    console.warn('[NoPes:Asset] Failed to resolve asset path:', relPath, e);
    return relPath;
  }
};

const NopesImage = Image.extend({
  addNodeView() {
    return ({ node, editor, getPos }: any) => {
      // docs store percent-encoded srcs (markdown-safe); files need raw
      const relPath = safeDecodeSrc(node.attrs.src || '');

      /* A media reference that points nowhere (moved file, or a dead
         temp reference like blob:/hex names from a bad paste) must say
         so clearly — not render as an empty box or a cryptic string. */
      const swapForMissing = (host: HTMLElement, kind: string) => {
        host.innerHTML = '';
        const ph = document.createElement('div');
        ph.setAttribute('contenteditable', 'false');
        ph.style.cssText = 'padding:14px 16px;border:1px dashed var(--red);border-radius:8px;color:var(--red);font-size:12.5px;margin:1rem 0;line-height:1.6;';
        ph.textContent = `⚠ ${kind} file not found: ${relPath} — drag the file into the note again to re-embed it.`;
        host.appendChild(ph);
      };
      const verifyExists = (host: HTMLElement, kind: string) => {
        if (relPath.startsWith('http') || relPath.startsWith('data:')) return;
        const vault = useStore.getState().vaultPath;
        if (!vault) return;
        const sep = vault.includes('\\') ? '\\' : '/';
        exists(`${vault}${sep}${relPath}`)
          .then(ok => { if (!ok) swapForMissing(host, kind); })
          .catch(() => {});
      };
      const isPdf  = /\.pdf$/i.test(relPath);
      const isVideo = /\.(mp4|webm|mov)$/i.test(relPath);

      let dom: HTMLElement;

      if (isPdf) {
        // ── PDF: full native iframe using WebKit's built-in PDF renderer ──
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin:1rem 0;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 30px rgba(0,0,0,0.4);position:relative;';
        
        // Loading indicator
        const loader = document.createElement('div');
        loader.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);color:#aaa;font-size:13px;z-index:1;';
        loader.textContent = 'Loading PDF…';
        wrapper.appendChild(loader);
        
        const iframe = document.createElement('iframe');
        iframe.dataset.relPath = relPath;
        iframe.src = resolveAssetSrc(relPath);
        iframe.style.cssText = 'width:100%;height:80vh;border:none;display:block;border-radius:8px;position:relative;z-index:2;';
        iframe.setAttribute('title', relPath.split(/[\/\\]/).pop() || 'PDF');
        iframe.setAttribute('loading', 'lazy');
        iframe.onload = () => { loader.remove(); };
        iframe.onerror = () => { loader.textContent = 'Failed to load PDF'; };
        
        wrapper.appendChild(iframe);
        verifyExists(wrapper, 'PDF');
        dom = wrapper;
      } else if (isVideo) {
        // ── Video: native <video> with controls ──────────────────────
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin:1rem 0;position:relative;';
        
        dom = document.createElement('video');
        const vid = dom as HTMLVideoElement;
        vid.dataset.relPath = relPath;
        vid.src = resolveAssetSrc(relPath);
        vid.controls = true;
        vid.loop = false;
        vid.preload = 'metadata'; // Don't preload full video, just metadata for zero-latency first frame
        vid.style.cssText = 'max-width:100%;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.4);display:block;';
        vid.onerror = () => {
          vid.style.opacity = '0.4';
          vid.insertAdjacentHTML('afterend', '<div style="color:#f87171;font-size:12px;margin-top:4px;">⚠ Video failed to load</div>');
        };
        
        wrapper.appendChild(vid);
        verifyExists(wrapper, 'Video');
        dom = wrapper;
      } else {
        // ── Image (with on-demand local OCR) ────────────────────────
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;margin:1rem 0;display:block;';

        const img = document.createElement('img');
        img.dataset.relPath = relPath;
        img.src = resolveAssetSrc(relPath);
        img.setAttribute('loading', 'lazy'); // Lazy load for performance
        if (node.attrs.alt)   img.alt   = node.attrs.alt;
        if (node.attrs.title) img.title = node.attrs.title;
        img.style.cssText = 'max-width:100%;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.4);display:block;transition:opacity 0.3s;';
        img.onload = () => { img.style.opacity = '1'; };
        img.onerror = () => {
          img.style.opacity = '0.3';
          img.alt = `⚠ Image not found: ${relPath}`;
        };
        wrapper.appendChild(img);

        const ocrBtn = document.createElement('button');
        ocrBtn.className = 'image-ocr-btn';
        ocrBtn.textContent = '🔍 OCR';
        ocrBtn.title = 'Extract text from this image (100% on-device)';
        ocrBtn.onclick = async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          ocrBtn.textContent = '⏳ Reading…';
          ocrBtn.disabled = true;
          try {
            // Read the actual bytes (asset:// URLs aren't always fetchable)
            let source: Blob | string;
            if (relPath.startsWith('data:') || relPath.startsWith('http')) {
              source = relPath;
            } else {
              const vault = useStore.getState().vaultPath;
              if (!vault) throw new Error('No vault open');
              const sep = vault.includes('\\') ? '\\' : '/';
              const bytes = await readFile(`${vault}${sep}${relPath}`);
              source = new Blob([bytes]);
            }
            const text = await recognizeImage(source);
            if (!text) {
              import('react-hot-toast').then(m => m.toast('No readable text found in this image.', { icon: '🔍' }));
            } else if (editor && !editor.isDestroyed && typeof getPos === 'function') {
              const quoted = text.split('\n').map((l: string) => `> ${l}`).join('\n');
              editor.chain().insertContentAt(getPos() + node.nodeSize, `\n${quoted}\n`).run();
              import('react-hot-toast').then(m => m.toast.success('Text extracted below the image'));
            }
          } catch (e: any) {
            console.error('[NoPes:OCR]', e);
            import('react-hot-toast').then(m => m.toast.error(`OCR failed: ${e?.message ?? e}`));
          } finally {
            ocrBtn.textContent = '🔍 OCR';
            ocrBtn.disabled = false;
          }
        };
        wrapper.appendChild(ocrBtn);
        verifyExists(wrapper, 'Image');
        dom = wrapper;
      }

      return { dom } as any;
    };
  }
});

/* ─────────────────────────────────────────────
   Mermaid Node View
───────────────────────────────────────────── */
const MermaidView = (props: any) => {
  const code = props.node.attrs.code || '';
  const theme = useStore(s => s.theme);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showCode, setShowCode] = useState(false);
  const id = React.useId().replace(/:/g, '');

  useEffect(() => {
    let active = true;
    const renderDiagram = async () => {
      try {
        if (!code.trim()) { setSvg(''); setError(''); return; }
        const m = await initMermaid();
        const { svg: s } = await m.render(`mermaid-${id}`, code);
        if (active) { setSvg(s); setError(''); }
      } catch (err: any) {
        if (active) setError(err.message || 'Syntax error');
      }
    };
    renderDiagram();
    return () => { active = false; };
  }, [code, id, theme]);

  const onCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    props.updateAttributes({ code: e.target.value });
  };

  return (
    <NodeViewWrapper className="mermaid-block">
      <div className="mermaid-topbar" contentEditable={false}>
        <div className="mermaid-label"><GitBranch size={12} /> Mermaid</div>
        <button className="mermaid-toggle" onClick={() => setShowCode(!showCode)}>
          {showCode ? 'Hide Source' : 'Edit Source'}
        </button>
      </div>
      {showCode && (
        <textarea 
          style={{ width: '100%', minHeight: '150px', background: 'transparent', color: 'inherit', border: 'none', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '13px', resize: 'vertical', outline: 'none' }}
          value={code}
          onChange={onCodeChange}
          onKeyDown={e => e.stopPropagation()}
        />
      )}
      {!showCode && (
        <div className="mermaid-render" dangerouslySetInnerHTML={{ __html: svg }} contentEditable={false} />
      )}
      {error && !showCode && <div className="mermaid-error" contentEditable={false}>{error}</div>}
    </NodeViewWrapper>
  );
};

/* ─────────────────────────────────────────────
   Properties bar — read-only frontmatter chips.
   Read-only on purpose: rewriting frontmatter through the editor is a
   data-risk path; the bar reflects what the Vault Index parsed.
───────────────────────────────────────────── */
const PropertiesBar: React.FC<{ notePath: string | null }> = ({ notePath }) => {
  const indexVersion = useStore(st => st.indexVersion);
  const props = React.useMemo(() => {
    void indexVersion;
    if (!notePath) return {} as Record<string, string>;
    return getVaultIndex().get(notePath)?.frontmatter ?? {};
  }, [notePath, indexVersion]);

  const entries = Object.entries(props);
  if (entries.length === 0) return null;

  return (
    <div className="properties-bar" contentEditable={false}>
      {entries.map(([k, v]) => (
        <span key={k} className="property-chip" title={`${k}: ${v}`}>
          <span className="property-key">{k}</span>
          <span className="property-value">{v}</span>
        </span>
      ))}
    </div>
  );
};

/* ─────────────────────────────────────────────
   Live Query Block (```nopes-query```)
───────────────────────────────────────────── */
const QueryBlockView = (props: any) => {
  const query = props.node.attrs.query || '';
  const indexVersion = useStore(st => st.indexVersion);
  const [showSource, setShowSource] = useState(!query);

  const results = React.useMemo(() => {
    void indexVersion;
    try { return runQuery(getVaultIndex().allNotes(), query); }
    catch { return []; }
  }, [query, indexVersion]);

  return (
    <NodeViewWrapper className="query-block">
      <div className="query-topbar" contentEditable={false}>
        <div className="mermaid-label"><Search size={12} /> Query{query ? `: ${query}` : ''}</div>
        <button className="mermaid-toggle" onClick={() => setShowSource(v => !v)}>
          {showSource ? 'Hide' : 'Edit'}
        </button>
      </div>
      {showSource && (
        <input
          className="query-input"
          placeholder="tag=#project status=active has=tasks sort=modified limit=10"
          defaultValue={query}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              props.updateAttributes({ query: (e.target as HTMLInputElement).value.trim() });
              setShowSource(false);
            }
          }}
          onBlur={e => props.updateAttributes({ query: e.target.value.trim() })}
        />
      )}
      <div className="query-results" contentEditable={false}>
        {results.length === 0 ? (
          <div className="query-empty">{query ? 'No matching notes.' : 'Type a query and press Enter.'}</div>
        ) : results.map(entry => (
          <button
            key={entry.path}
            className="query-result"
            onClick={() => useStore.getState().openFile(entry.path)}
          >
            <FileText size={12} />
            <span className="query-result-name">{queryNoteName(entry)}</span>
            <span className="query-result-meta">
              {entry.wordCount}w{entry.tasks.length > 0 ? ` · ${entry.tasks.filter(t => !t.checked).length} open tasks` : ''}
              {entry.mtime ? ` · ${new Date(entry.mtime).toLocaleDateString()}` : ''}
            </span>
          </button>
        ))}
      </div>
    </NodeViewWrapper>
  );
};

const QueryBlockExtension = QueryBlockNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(QueryBlockView);
  },
});

/* Schema in src/extensions/MermaidNode.ts (headlessly testable);
   the React node view is attached here. */
const MermaidExtension = MermaidNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});


/* ─────────────────────────────────────────────
   WikiLink suggestion list
───────────────────────────────────────────── */
const SuggestionList = React.forwardRef<any, any>((props, ref) => {
  const [sel, setSel] = useState(0);
  const pick = (i: number) => {
    const item = props.items[i];
    if (item) props.command({ id: item.name.replace(/\.md$/, '') });
  };
  React.useImperativeHandle(ref, () => ({
    onKeyDown({ event }: { event: KeyboardEvent }) {
      if (!props.items.length) return false;
      if (event.key === 'ArrowUp')   { setSel(s => (s + props.items.length - 1) % props.items.length); return true; }
      if (event.key === 'ArrowDown') { setSel(s => (s + 1) % props.items.length); return true; }
      if (event.key === 'Enter')     { pick(sel); return true; }
      return false;
    },
  }));
  if (!props.items.length) return null;
  return (
    <div className="suggestion-list">
      {props.items.map((item: any, i: number) => (
        <button key={i} className={`suggestion-item ${i === sel ? 'is-selected' : ''}`} onClick={() => pick(i)}>
          <FileText size={13} />{item.name.replace(/\.md$/, '')}
        </button>
      ))}
    </div>
  );
});

/* ─────────────────────────────────────────────
   [[WikiLink]] TipTap extension (Typeahead)
───────────────────────────────────────────── */
const WikiLinkExtension = Extension.create({
  name: 'wikiLink',
  addOptions() { return { suggestion: {} as SuggestionOptions }; },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

/* ─────────────────────────────────────────────
   Markdown Templates
─────────────────────────────────────────── */
const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// Computed on demand — a module-level constant would bake in the date
// at app launch and go stale after midnight.
const getTemplates = (): Record<string, string> => ({
  'Daily Note': `## 🗓️ ${today()}

### Intentions
- 

### Notes


### Gratitude
1. 
2. 
3. `,
  'Meeting Minutes': `## Meeting: [Title]
**Date:** ${today()}  
**Attendees:** 

---

### Agenda
1. 

### Discussion


### Action Items
| Task | Owner | Due |
|------|-------|-----|
|      |       |     |

### Next Meeting
`,
  'Bug Report': `## 🐛 Bug: [Short Description]

### Environment
- **OS:** 
- **Version:** 
- **Browser/Runtime:** 

### Steps to Reproduce
1. 
2. 
3. 

### Expected Behaviour


### Actual Behaviour


### Severity
- [ ] Critical  - [ ] High  - [ ] Medium  - [ ] Low
`,
  'Code Review': `## Code Review: [PR Title]
**PR:** #  
**Author:**   
**Reviewer:** ${today()}

### Summary


### Checklist
- [ ] Logic is correct
- [ ] Edge cases handled
- [ ] Tests included
- [ ] No unnecessary complexity
- [ ] Naming is clear

### Comments

`,
  'Weekly Review': `## Week of ${today()}

### ✅ Wins
- 

### 🚧 Challenges
- 

### 📊 Metrics


### 🔭 Next Week Focus
1.
2.
3.
`,
});

/* ─────────────────────────────────────────────
   Slash Commands
───────────────────────────────────────────── */
const COMMAND_ITEMS = [
  // ─ Formatting
  { title: 'Heading 1',     group: 'Format', icon: <Heading1 size={14} />,     command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2',     group: 'Format', icon: <Heading2 size={14} />,     command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
  { title: 'Heading 3',     group: 'Format', icon: <Heading3 size={14} />,     command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
  { title: 'Bold',          group: 'Format', icon: <Bold size={14} />,         command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setMark('bold').run() },
  { title: 'Italic',        group: 'Format', icon: <Italic size={14} />,       command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setMark('italic').run() },
  { title: 'Task List',     group: 'Format', icon: <CheckSquare size={14} />,  command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
  { title: 'Bullet List',   group: 'Format', icon: <List size={14} />,         command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: 'Numbered List', group: 'Format', icon: <ListOrdered size={14} />,  command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: 'Quote',         group: 'Format', icon: <Quote size={14} />,        command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: 'Code Block',    group: 'Format', icon: <Code size={14} />,         command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: 'Divider',       group: 'Format', icon: <Minus size={14} />,        command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  // ─ Inserts
  { title: 'Table',         group: 'Insert', icon: <Grid3x3 size={14} />,      command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertTable({ rows: 1, cols: 2, withHeaderRow: false }).run() },
  { title: 'Flashcard',     group: 'Insert', icon: <GitBranch size={14} />,   command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertContent('Question ?? Answer').run() },
  { title: 'Query Block',   group: 'Insert', icon: <Search size={14} />,       command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertContent({ type: 'queryBlock', attrs: { query: '' } }).run() },
  { title: 'Mermaid Diagram', group: 'Insert', icon: <GitBranch size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertContent({ type: 'mermaidNode', attrs: { code: 'graph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Result 1]\n    B -->|No| D[Result 2]' } }).run() },
  // ─ Templates
  ...Object.keys(getTemplates()).map((title) => ({
    title,
    group: 'Template',
    icon: <LayoutTemplate size={14} />,
    // resolve the template at insert time so dates are current
    command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertContent(getTemplates()[title] + '\n').run(),
  })),
];

const SlashCommandList = React.forwardRef<any, any>((props, ref) => {
  const [sel, setSel] = useState(0);
  const pick = (i: number) => {
    const item = props.items[i];
    if (item && !item.isHeader) props.command(item);
  };
  void pick; // referenced via onKeyDown Enter handler below
  // Flat selectable indices (exclude headers)
  const selectableItems = props.items.filter((it: any) => !it.isHeader);
  React.useImperativeHandle(ref, () => ({
    onKeyDown({ event }: { event: KeyboardEvent }) {
      if (!selectableItems.length) return false;
      if (event.key === 'ArrowUp')   { setSel(s => (s + selectableItems.length - 1) % selectableItems.length); return true; }
      if (event.key === 'ArrowDown') { setSel(s => (s + 1) % selectableItems.length); return true; }
      if (event.key === 'Enter')     {
        const item = selectableItems[sel];
        if (item) props.command(item);
        return true;
      }
      return false;
    },
  }));
  if (!props.items.length) return null;
  let selectIdx = -1;
  return (
    <div className="suggestion-list">
      {props.items.map((item: any, i: number) => {
        if (item.isHeader) return (
          <div key={i} className="suggestion-group-header">{item.title}</div>
        );
        selectIdx++;
        const si = selectIdx;
        return (
          <button key={i} className={`suggestion-item ${si === sel ? 'is-selected' : ''}`} onClick={() => props.command(item)} onMouseDown={e => e.preventDefault()}>
            <span style={{ marginRight: 6, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
            <span>{item.title}</span>
            {item.group === 'Template' && <span className="suggestion-badge">template</span>}
          </button>
        );
      })}
    </div>
  );
});

const SlashCommandExtension = Extension.create({
  name: 'slashCommand',
  addOptions() { return { suggestion: {} as SuggestionOptions }; },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

/* ─────────────────────────────────────────────
   WikiLink Decorator (Exact click & Hover)
───────────────────────────────────────────── */
const wikiLinkPluginKey = new PluginKey('wikiLinkDecorator');

const WikiLinkDecorator = Extension.create({
  name: 'wikiLinkDecorator',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikiLinkPluginKey,
        state: {
          init(_, { doc }) {
            const decorations: Decoration[] = [];
            doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                const regex = /\[\[([^\]|#\n]+?)(?:\|[^\]]+?)?\]\]/g;
                let m;
                while ((m = regex.exec(node.text)) !== null) {
                  decorations.push(
                    Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                      nodeName: 'span',
                      class: 'wikilink-marker',
                      'data-target': m[1].trim(),
                    })
                  );
                }
              }
            });
            return DecorationSet.create(doc, decorations);
          },
          apply(tr, old) {
            if (!tr.docChanged) return old.map(tr.mapping, tr.doc);
            const decorations: Decoration[] = [];
            tr.doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                const regex = /\[\[([^\]|#\n]+?)(?:\|[^\]]+?)?\]\]/g;
                let m;
                while ((m = regex.exec(node.text)) !== null) {
                  decorations.push(
                    Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                      nodeName: 'span',
                      class: 'wikilink-marker',
                      'data-target': m[1].trim(),
                    })
                  );
                }
              }
            });
            return DecorationSet.create(tr.doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return wikiLinkPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

/* ─────────────────────────────────────────────
   Toolbar Button Helper
───────────────────────────────────────────── */
const TBtn: React.FC<{
  active?: boolean; title: string; onClick: () => void; children: React.ReactNode;
}> = ({ active, title, onClick, children }) => (
  <button
    className={`toolbar-btn ${active ? 'is-active' : ''}`}
    title={title}
    onClick={onClick}
    onMouseDown={e => e.preventDefault()}
  >
    {children}
  </button>
);

const Divider = () => <div className="toolbar-divider" />;

/* ─────────────────────────────────────────────
   Table Floating Toolbar
───────────────────────────────────────────── */
const TableToolbar: React.FC<{ editor: ReturnType<typeof useEditor> }> = ({ editor }) => {
  if (!editor || !editor.isActive('table')) return null;
  const c = editor.chain().focus();
  return (
    <div className="table-toolbar">
      <span className="table-toolbar-label"><TableIcon size={12}/> Table</span>
      <div className="table-toolbar-divider" />
      <button className="table-tb-btn" title="Add row above" onMouseDown={e => { e.preventDefault(); c.addRowBefore().run(); }}><ChevronUp size={13}/><RowsIcon size={12}/></button>
      <button className="table-tb-btn" title="Add row below" onMouseDown={e => { e.preventDefault(); c.addRowAfter().run(); }}><ChevronDown size={13}/><RowsIcon size={12}/></button>
      <button className="table-tb-btn" title="Delete row" onMouseDown={e => { e.preventDefault(); c.deleteRow().run(); }}><Trash size={12}/><RowsIcon size={12}/></button>
      <div className="table-toolbar-divider" />
      <button className="table-tb-btn" title="Add column left" onMouseDown={e => { e.preventDefault(); c.addColumnBefore().run(); }}><ChevronLeft size={13}/><Columns size={12}/></button>
      <button className="table-tb-btn" title="Add column right" onMouseDown={e => { e.preventDefault(); c.addColumnAfter().run(); }}><ChevronRight size={13}/><Columns size={12}/></button>
      <button className="table-tb-btn" title="Delete column" onMouseDown={e => { e.preventDefault(); c.deleteColumn().run(); }}><Trash size={12}/><Columns size={12}/></button>
      <div className="table-toolbar-divider" />
      <button className="table-tb-btn" title="Toggle header row" onMouseDown={e => { e.preventDefault(); c.toggleHeaderRow().run(); }}>H</button>
      <button className="table-tb-btn table-tb-delete" title="Delete table" onMouseDown={e => { e.preventDefault(); c.deleteTable().run(); }}><Trash2 size={13}/></button>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Formatting Toolbar
───────────────────────────────────────────── */
const Toolbar: React.FC<{
  editor: ReturnType<typeof useEditor>;
  onInsertImage: () => void;
  onInsertLink: () => void;
}> = ({ editor, onInsertImage, onInsertLink }) => {
  const [showColor, setShowColor] = useState(false);
  const COLORS = ['#e8e8e8','#ffffff','#a78bfa','#60a5fa','#34d399','#fbbf24','#f87171','#f472b6'];
  const SIZES  = ['12px','14px','16px','18px','20px','24px','28px','32px'];

  if (!editor) return null;

  return (
    <div className="editor-toolbar">
      <TBtn active={editor.isActive('heading',{level:1})} title="H1" onClick={() => editor.chain().focus().toggleHeading({level:1}).run()}><Heading1 size={15}/></TBtn>
      <TBtn active={editor.isActive('heading',{level:2})} title="H2" onClick={() => editor.chain().focus().toggleHeading({level:2}).run()}><Heading2 size={15}/></TBtn>
      <TBtn active={editor.isActive('heading',{level:3})} title="H3" onClick={() => editor.chain().focus().toggleHeading({level:3}).run()}><Heading3 size={15}/></TBtn>
      <Divider/>
      <TBtn active={editor.isActive('bold')} title="Bold (⌘B)" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15}/></TBtn>
      <TBtn active={editor.isActive('italic')} title="Italic (⌘I)" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15}/></TBtn>
      <TBtn active={editor.isActive('underline')} title="Underline (⌘U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15}/></TBtn>
      <TBtn active={editor.isActive('strike')} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15}/></TBtn>
      <TBtn active={editor.isActive('code')} title="Code" onClick={() => editor.chain().focus().toggleCode().run()}><Code size={15}/></TBtn>
      <Divider/>
      <select
        className="toolbar-select"
        value={(() => {
          const attrs = editor.getAttributes('textStyle');
          return attrs?.fontSize || '16px';
        })()}
        title="Font size"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => {
          const size = e.target.value;
          if (size === '16px') {
            (editor.chain().focus() as any).unsetFontSize().run();
          } else {
            (editor.chain().focus() as any).setFontSize(size).run();
          }
        }}
      >
        <option value="16px">Default</option>
        {SIZES.filter(s => s !== '16px').map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div style={{ position: 'relative' }}>
        <button className="toolbar-btn" title="Text color" onMouseDown={e => { e.preventDefault(); setShowColor(v => !v); }}>
          <Palette size={15}/>
        </button>
        {showColor && (
          <div className="color-picker-popup">
            {COLORS.map(c => (
              <button key={c} className="color-swatch" style={{ background: c }} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setShowColor(false); }}/>
            ))}
            <button className="color-swatch color-swatch-reset" onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColor(false); }}>✕</button>
          </div>
        )}
      </div>
      <Divider/>
      <TBtn active={editor.isActive('bulletList')} title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15}/></TBtn>
      <TBtn active={editor.isActive('orderedList')} title="Ordered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15}/></TBtn>
      <TBtn active={editor.isActive('blockquote')} title="Blockquote" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15}/></TBtn>
      <TBtn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={15}/></TBtn>
      <Divider/>
      <TBtn active={editor.isActive('link')} title="Insert link" onClick={onInsertLink}><LinkIcon size={15}/></TBtn>
      <TBtn title="Insert image" onClick={onInsertImage}><ImageIcon size={15}/></TBtn>
      <Divider/>
      <TBtn active={editor.isActive('table')} title="Insert table (1×2)" onClick={() => editor.chain().focus().insertTable({ rows: 1, cols: 2, withHeaderRow: false }).run()}><Grid3x3 size={15}/></TBtn>
    </div>
  );
};


/* ─────────────────────────────────────────────
   Link Modal
───────────────────────────────────────────── */
const LinkModal: React.FC<{
  onConfirm: (url: string, text?: string) => void;
  onClose: () => void;
  existing?: string;
}> = ({ onConfirm, onClose, existing }) => {
  const [url, setUrl] = useState(existing ?? 'https://');
  const [text, setText] = useState('');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Insert Link</div>
        <label className="modal-label">URL</label>
        <input className="modal-input" autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
        <label className="modal-label">Display text (optional)</label>
        <input className="modal-input" value={text} onChange={e => setText(e.target.value)} placeholder="Link label" />
        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={() => { onConfirm(url, text || undefined); onClose(); }}>Insert</button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   In-Note Search Bar Component
───────────────────────────────────────────── */
const SearchBar: React.FC<{
  query: string;
  onQueryChange: (q: string) => void;
  matchIndex: number;
  matchCount: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}> = ({ query, onQueryChange, matchIndex, matchCount, onPrev, onNext, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter') { e.shiftKey ? onPrev() : onNext(); }
  };

  return (
    <div className="note-search-bar" onMouseDown={e => e.stopPropagation()}>
      <div className="note-search-inner">
        <Search size={14} className="note-search-icon" />
        <input
          ref={inputRef}
          className="note-search-input"
          placeholder="Find in note…"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        {query && (
          <span className="note-search-count">
            {matchCount === 0 ? 'No results' : `${matchIndex + 1} / ${matchCount}`}
          </span>
        )}
        <button className="note-search-nav-btn" title="Previous (⇧Enter)" onClick={onPrev} disabled={matchCount === 0}>
          <ChevronUp size={14} />
        </button>
        <button className="note-search-nav-btn" title="Next (Enter)" onClick={onNext} disabled={matchCount === 0}>
          <ChevronDown size={14} />
        </button>
        <button className="note-search-close-btn" title="Close (Esc)" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Main NoteEditor
───────────────────────────────────────────── */
/**
 * Convert raw markdown math ($$...$$  and  $...$) into the HTML that
 * @aarkue/tiptap-math-extension can parse when tiptap-markdown loads the file.
 * Block math  → <span data-type="inlineMath" data-latex="..." data-display="yes"></span>
 * Inline math → <span data-type="inlineMath" data-latex="..."></span>
 * We escape HTML entities in the latex to prevent XSS / mangling.
 */
function preprocessMath(md: string): string {
  const escAttr = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Block math: $$...$$  (greedy is fine – math shouldn't span paragraphs)
  let out = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex) => {
    const safe = escAttr(latex.trim());
    return `<span data-type="inlineMath" data-latex="${safe}" data-display="yes"></span>`;
  });

  // Inline math: $...$ — require non-space at edges to avoid false positives (e.g. US $5)
  out = out.replace(/\$([^\s$][^$]*[^\s$]|[^\s$])\$/g, (_m, latex) => {
    const safe = escAttr(latex.trim());
    return `<span data-type="inlineMath" data-latex="${safe}"></span>`;
  });

  return out;
}

export const NoteEditor: React.FC<{ tabId?: string }> = ({ tabId }) => {
  const { 
    allFiles, activeTab, tabContents, saveFile, openFile, createFile, graphData,
    pendingAssetInserts, setPendingAssetInserts, aiIndex,
    zenMode
  } = useStore();
  
  const currentTab = tabId || activeTab;
  const [saving, setSaving] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [existingLink, setExistingLink] = useState<string | undefined>();
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [suggestedLinks, setSuggestedLinks] = useState<LinkSuggestion[]>([]);
  const [aiStatus, setAiStatus] = useState('idle');
  const allFilesRef = useRef(allFiles);
  const tabContentsRef = useRef(tabContents);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<any>(null);

  // ── In-note search state ──────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchMatchCount, setSearchMatchCount] = useState(0);

  // ── Combo widget state ─────────────────────────────────────────────
  const [comboCount, setComboCount] = useState(0);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDocSizeRef = useRef(-1); // -1 = uninitialised (set after editor ready)

  const storeActionsRef = useRef({ openFile, createFile, saveFile });
  const importFileObjectsRef = useRef<((files: FileList) => Promise<void>) | null>(null);
  useEffect(() => { storeActionsRef.current = { openFile, createFile, saveFile }; }, [openFile, createFile, saveFile]);

  const content = currentTab ? (tabContents[currentTab] ?? '') : '';
  useEffect(() => { allFilesRef.current = allFiles; }, [allFiles]);
  useEffect(() => { tabContentsRef.current = tabContents; }, [tabContents]);

  // ── Tag-based features (aura, stamp, #topsecret) ─────────────────
  const tags = extractTags(content);
  const auraClass = tags.includes('task') ? 'aura-task'
    : tags.includes('creative') ? 'aura-creative'
    : tags.includes('journal') ? 'aura-journal'
    : '';
  const stampLabel = tags.includes('done') ? 'DONE'
    : tags.includes('approved') ? 'APPROVED'
    : tags.includes('draft') ? 'DRAFT'
    : null;
  const isTopSecret = tags.includes('topsecret');

  const fileName = currentTab?.split('/').pop()?.replace(/\.md$/, '') ?? 'Untitled';
  // Memoized + endpointId-safe: force-graph mutates link.source/target
  // into node objects, and an unstable array identity here used to make
  // the unlinked-mentions effect re-read the vault on every render.
  const backlinksFiles = useMemo(() => {
    const endpointId = (e: any) => (typeof e === 'object' && e !== null ? e.id : e);
    const sources = new Set(
      graphData.links.filter(l => endpointId(l.target) === currentTab).map(l => endpointId(l.source))
    );
    return allFiles.filter(f => sources.has(f.path));
  }, [graphData.links, allFiles, currentTab]);

  // AI Tag Suggestions
  useEffect(() => {
    const unsub = AIService.onStatus(setAiStatus);
    return unsub;
  }, []);

  useEffect(() => {
    const { isAiEnabled } = useStore.getState();
    if (!isAiEnabled || aiStatus !== 'ready' || content.length < 50 || !aiIndex.length) return;
    const to = setTimeout(async () => {
      try {
        const qVec = await AIService.embedQuery(content);
        const hits = await AIService.search(qVec, aiIndex, 5);
        const cachedContents = tabContentsRef.current;
        const tags = new Set<string>();
        for (const h of hits) {
          if (h.score < 0.25 || h.path === currentTab) continue;
          const text = cachedContents[h.path];
          if (text) {
            extractTags(text).forEach(t => tags.add(t));
          }
        }
        const currentTags = new Set(extractTags(content));
        const newTags = Array.from(tags).filter(t => !currentTags.has(t)).slice(0, 4);
        setSuggestedTags(newTags);

        // AI auto-linking: the same semantic hits, filtered down to
        // "related notes you haven't linked yet".
        setSuggestedLinks(filterLinkSuggestions(
          hits, currentTab ?? null, content, currentTab ? loadDismissed(currentTab) : new Set(),
        ));
      } catch {}
    }, 1500);
    return () => clearTimeout(to);
  }, [content, aiIndex, aiStatus, currentTab]);

  interface UnlinkedHit { file: (typeof allFiles)[number]; count: number; snippet: string }
  const [unlinkedMentions, setUnlinkedMentions] = useState<UnlinkedHit[]>([]);

  useEffect(() => {
    if (!currentTab || !fileName) {
      setUnlinkedMentions([]);
      return;
    }
    let cancel = false;
    const MAX_SCAN = 500;
    const computeUnlinked = async () => {
      const hits: UnlinkedHit[] = [];
      const cachedContents = tabContentsRef.current;

      for (const f of allFiles.slice(0, MAX_SCAN)) {
        if (cancel) return;
        if (f.path === currentTab) continue;

        let text = cachedContents[f.path];
        if (text === undefined) {
           try { text = await readTextFile(f.path); } catch { text = ''; }
        }

        const mentions = findUnlinkedMentions(text, fileName);
        if (mentions.length > 0) {
          hits.push({ file: f, count: mentions.length, snippet: mentions[0].snippet });
        }
      }
      if (!cancel) setUnlinkedMentions(hits);
    };
    // Debounced: don't hammer the disk while the user flips through notes
    const t = setTimeout(computeUnlinked, 800);
    return () => { cancel = true; clearTimeout(t); };
  }, [currentTab, fileName, allFiles]);

  const linkMention = async (hit: UnlinkedHit) => {
    try {
      const cached = tabContentsRef.current[hit.file.path];
      const text = cached !== undefined ? cached : await readTextFile(hit.file.path);
      const { content: linkedContent, linked } = linkMentions(text, fileName);
      if (linked === 0) return;
      await storeActionsRef.current.saveFile(hit.file.path, linkedContent);
      setUnlinkedMentions(prev => prev.filter(h => h.file.path !== hit.file.path));
      import('react-hot-toast').then(m =>
        m.toast.success(`Linked ${linked} mention${linked > 1 ? 's' : ''} in "${hit.file.name.replace(/\.md$/, '')}"`)
      );
    } catch (e: any) {
      import('react-hot-toast').then(m => m.toast.error(`Could not link: ${e?.message ?? e}`));
    }
  };

  const insertImage = async (editor: ReturnType<typeof useEditor>) => {
    if (!editor) return;
    const selected = await open({ multiple: false, filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','gif','webp','svg'] }] });
    if (!selected) return;
    try {
      const bytes = await readFile(selected as string);
      const ext = (selected as string).split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      
      const blob = new Blob([bytes], { type: mime });
      const reader = new FileReader();
      reader.onloadend = () => {
        editor.chain().focus().setImage({ src: reader.result as string }).run();
      };
      reader.readAsDataURL(blob);
    } catch(e) { console.error('Image insert error:', e); }
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit, // native codeBlock: editable, contentDOM-backed, serialize-safe
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        MermaidExtension,
        QueryBlockExtension,
        MermaidExtension,
        QueryBlockExtension,
        MathExtension.configure({ evaluation: false }),
        FoldingExtension,
        Underline,
        TextStyle,
        FontSize,
        Color,
        NopesImage.configure({ allowBase64: true }),
        LinkExtension.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
        Markdown.configure({
          html: true,
          transformCopiedText: false,
          transformPastedText: false,
        }),
        WikiLinkDecorator,
        WikiLinkExtension.configure({
          suggestion: {
            char: '[[',
            allowSpaces: true,
            startOfLine: false,
            allow: ({ editor, range }: any) => {
              try {
                if (range.from < 0 || range.to > editor.state.doc.content.size) return false;
                const text = editor.state.doc.textBetween(range.from, range.to);
                return !text.includes(']]');
              } catch (e) {
                return false;
              }
            },
            command: ({ editor, range, props }: any) => {
              editor.chain().focus().deleteRange(range).insertContent(`[[${props.id}]] `).run();
            },
            items: ({ query }: { query: string }) =>
              allFilesRef.current
                .filter(f => f.name.replace(/\.md$/, '').toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8),
            render: () => {
              let component: ReactRenderer, popup: Instance[];
              return {
                onStart: (p: any) => {
                  component = new ReactRenderer(SuggestionList, { props: p, editor: p.editor });
                  popup = tippy('body', {
                    getReferenceClientRect: p.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true, interactive: true, trigger: 'manual', placement: 'bottom-start',
                  });
                },
                onUpdate: (p: any) => { component.updateProps(p); popup[0]?.setProps({ getReferenceClientRect: p.clientRect }); },
                onKeyDown: (p: any) => {
                  if (p.event.key === 'Escape') { popup[0]?.hide(); return true; }
                  return (component.ref as any)?.onKeyDown(p) ?? false;
                },
                onExit: () => { popup[0]?.destroy(); component.destroy(); },
              };
            },
          },
        }),
        SlashCommandExtension.configure({
          suggestion: {
            pluginKey: new PluginKey('slashCommandSuggestion'),
            char: '/',
            startOfLine: false,
            command: ({ editor, range, props }: any) => {
              props.command({ editor, range });
            },
            items: ({ query }: { query: string }) =>
              COMMAND_ITEMS.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10),
            render: () => {
              let component: ReactRenderer, popup: Instance[];
              return {
                onStart: (p: any) => {
                  component = new ReactRenderer(SlashCommandList, { props: p, editor: p.editor });
                  if (!p.clientRect) return;
                  popup = tippy('body', {
                    getReferenceClientRect: p.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true, interactive: true, trigger: 'manual', placement: 'bottom-start',
                  });
                },
                onUpdate: (p: any) => { component.updateProps(p); popup?.[0]?.setProps({ getReferenceClientRect: p.clientRect }); },
                onKeyDown: (p: any) => {
                  if (p.event.key === 'Escape') { popup?.[0]?.hide(); return true; }
                  return (component.ref as any)?.onKeyDown(p) ?? false;
                },
                onExit: () => { popup?.[0]?.destroy(); component?.destroy(); },
              };
            },
          },
        }),
      ],
      content: preprocessMath(content),
      onUpdate: ({ editor }) => {
        if (!currentTab) return;

        const md = (editor.storage as any).markdown.getMarkdown();

        // ── Autosave ──────────────────────────────────────────────────
        const { isAutoSaveEnabled } = useStore.getState();
        if (isAutoSaveEnabled) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          setSaving(true);
          saveTimerRef.current = setTimeout(() => {
            saveFile(currentTab, md).finally(() => setTimeout(() => setSaving(false), 600));
          }, 400);
        }

        // ── Combo: only increment on actual character insertions ────────
        const newSize = editor.state.doc.content.size;
        if (lastDocSizeRef.current >= 0 && newSize > lastDocSizeRef.current) {
          setComboCount(prev => prev + 1);
          if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
          comboTimerRef.current = setTimeout(() => setComboCount(0), COMBO_RESET_MS);
        }
        lastDocSizeRef.current = newSize;

        // ── Achievements: wikilink & word milestones ──────────────────
        const wordCount = md.trim().split(/\s+/).filter(Boolean).length;
        const { unlockAchievement: unlock, allFiles: af } = useStore.getState();
        if (/\[\[.+?\]\]/.test(md)) unlock('first-link', 'First Connection');
        if (wordCount >= 500) unlock('deep-diver-500', 'Deep Diver');
        if (wordCount >= 2000) unlock('novelist', 'Novelist');
        if (af.filter(f => !f.is_dir).length >= 10) unlock('architect-10', 'Architect');
      },
      editorProps: {
        attributes: {
          spellcheck: 'false',
        },
        // Files must NEVER be handled by ProseMirror's defaults: WebKit
        // hands it temp-file references (random hex names) that break on
        // restart. Returning true blocks PM; the events still bubble to
        // our importer (drop) or we import directly (paste).
        handleDrop: (_view, event) => {
          if (event.dataTransfer?.files?.length) return true;
          return false;
        },
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files;
          if (files && files.length > 0) {
            importFileObjectsRef.current?.(files);
            return true;
          }
          return false;
        },
      },
    },
    [currentTab],
  );

  // Robust cleanup of prior editor instances (L-01)
  useEffect(() => {
    if (editor) {
      editorRef.current = editor;
    }
    return () => {
      // A pending autosave means unsaved keystrokes — flush them now,
      // BEFORE the editor is destroyed, or the last <400ms of typing is
      // lost when switching views (e.g. editor → Kanban).
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        try {
          const ed = editorRef.current;
          if (ed && !ed.isDestroyed && currentTab) {
            const md = (ed.storage as any).markdown?.getMarkdown?.();
            if (typeof md === 'string') saveFile(currentTab, md);
          }
        } catch (e) {
          console.warn('[NoteEditor] Flush-on-unmount failed:', e);
        }
      }
      // Cancel combo timer to prevent setState-after-unmount
      if (comboTimerRef.current) {
        clearTimeout(comboTimerRef.current);
        comboTimerRef.current = null;
      }
      lastDocSizeRef.current = -1;
      if (editorRef.current) {
        console.log('[NoteEditor] Explicitly destroying editor instance.');
        editorRef.current = disposeEditorInstance(editorRef.current);
      }
    };
  }, [editor]);

  // Sync content when tab changes; also reset lastDocSizeRef so combo
  // doesn't fire spuriously on the first update after a tab switch.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      const curr = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
      // TipTap drops the <!-- CANVAS/KANBAN --> marker comment, and
      // saveFile re-prepends it — normalize both sides so that round
      // trip doesn't register as a perpetual external change.
      const stripMarker = (s: string) => s.replace(/^<!--\s*(CANVAS|KANBAN)\s*-->\s*/i, '');
      if (stripMarker(curr) !== stripMarker(content)) {
        editor.commands.setContent(preprocessMath(content), { emitUpdate: false } as any);
      }
      // Initialise / reset the baseline doc size for the combo guard
      lastDocSizeRef.current = editor.state.doc.content.size;
    } catch (e) {
      console.warn('[NoteEditor] Content sync failed (editor may be transitioning):', e);
    }
  }, [currentTab, content]);

  // Auto-insert dragged assets — only in the active (left) editor, or
  // split view inserts every asset into both panes.
  useEffect(() => {
    if (currentTab !== useStore.getState().activeTab) return;
    if (editor && !editor.isDestroyed && pendingAssetInserts.length > 0) {
      try {
        pendingAssetInserts.forEach(pth => {
          // TipTap Image Extension syntax -> inserts the logical path natively into the doc.
          editor.chain().focus().setImage({ src: encodeMediaSrc(pth) }).run();
        });
      } catch (e) {
        console.warn('[NoteEditor] Failed to insert dragged assets:', e);
      }
      setPendingAssetInserts([]);
    }
  }, [editor, pendingAssetInserts, setPendingAssetInserts]);

// Drag-and-drop handler (used via JSX props on editor-body)
const [isDragOver, setIsDragOver] = useState(false);

const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  setIsDragOver(true);
};

const handleDragLeave = () => setIsDragOver(false);

const [isImporting, setIsImporting] = useState(false);

/** Import browser File objects into assets/ and queue editor inserts.
    Shared by drag-drop and paste so BOTH paths produce real vault files —
    ProseMirror's default handling would otherwise insert WebKit's
    temporary file references (random hex names) that die on restart. */
const importFileObjects = async (files: FileList) => {
  setIsImporting(true);
  try {
    const assetsDir = await join(useStore.getState().vaultPath || '', 'assets');
    if (!(await exists(assetsDir))) {
      await mkdir(assetsDir);
    }
    const newInserts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!['png','jpg','jpeg','gif','webp','svg','mp4','webm','mov','pdf'].includes(ext)) continue;
      try {
        const arrayBuf = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        const uniqueName = `${Date.now()}_${sanitizeImportFileName(file.name)}`;
        const targetPath = await join(assetsDir, uniqueName);
        await writeFile(targetPath, uint8);
        const relPath = 'assets/' + uniqueName;
        newInserts.push(relPath);
        useStore.getState().addMedia({
          id: `${Date.now()}_${i}`,
          type: ['mp4','webm','mov'].includes(ext) ? 'video' : 'image',
          src: relPath,
        });
      } catch (fileErr) {
        console.error(`[NoPes:Drop] Failed to import ${file.name}:`, fileErr);
        import('react-hot-toast').then(m => m.toast.error(`Failed to import ${file.name}`));
      }
    }
    if (newInserts.length) {
      setPendingAssetInserts([...pendingAssetInserts, ...newInserts]);
      import('react-hot-toast').then(m => m.toast.success(`Imported ${newInserts.length} file(s)`));
    }
  } catch (err) {
    console.error('[NoPes:Drop] Import failed:', err);
    import('react-hot-toast').then(m => m.toast.error('Media import failed'));
  } finally {
    setIsImporting(false);
  }
};

const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  setIsDragOver(false);
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  await importFileObjects(files);
};
importFileObjectsRef.current = importFileObjects;

// ── Context menu for media elements ───────────────────────
type CtxMenu = { x: number; y: number; domNode: HTMLElement } | null;
const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);

// ── Context menu for table cells ─────────────────────────
type TableCtxMenu = { x: number; y: number; cellElement: HTMLElement } | null;
const [tableCtxMenu, setTableCtxMenu] = useState<TableCtxMenu>(null);

// Keep context menu within viewport bounds
// If near bottom, flip menu to appear above the click point
const constrainToViewport = (x: number, y: number, menuWidth = 150, menuHeight = 280) => {
  const padding = 8;
  const flipThreshold = window.innerHeight - menuHeight - padding;
  
  // Constrain X
  const maxX = window.innerWidth - menuWidth - padding;
  const constrainedX = Math.min(Math.max(padding, x), maxX);
  
  // Flip Y if near bottom
  let constrainedY = y;
  if (y > flipThreshold) {
    constrainedY = y - menuHeight; // Show above click
  }
  // Ensure Y stays within bounds
  constrainedY = Math.min(Math.max(padding, constrainedY), window.innerHeight - menuHeight - padding);
  
  return { x: constrainedX, y: constrainedY };
};

const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
  const target = e.target as HTMLElement;
  
  // Check for table cell first (higher priority)
  const cell = target.closest('td, th') as HTMLElement | null;
  if (cell && editor?.isActive('table')) {
    e.preventDefault();
    const pos = constrainToViewport(e.clientX, e.clientY);
    setTableCtxMenu({ x: pos.x, y: pos.y, cellElement: cell });
    return;
  }
  
  // Walk up to find img / video / iframe
  const media = target.closest('img, video, iframe') as HTMLElement | null;
  if (!media) return; // not a media element — let browser handle it
  e.preventDefault();
  const pos = constrainToViewport(e.clientX, e.clientY, 120, 40);
  setCtxMenu({ x: pos.x, y: pos.y, domNode: media });
};

const closeCtxMenu = () => setCtxMenu(null);

const deleteMediaNode = () => {
  if (!editor || editor.isDestroyed || !ctxMenu) return;
  try {
    const view = editor.view;
    // Walk up from the clicked DOM element to find the node wrapper
    let node: HTMLElement | null = ctxMenu.domNode;
    // For PDFs the actual node dom is the wrapper div
    if (node.tagName === 'IFRAME') node = node.parentElement;
    if (!node) return;
    const pos = view.posAtDOM(node, 0);
    const $pos = view.state.doc.resolve(pos);
    const nodeAt = view.state.doc.nodeAt($pos.pos);
    if (nodeAt) {
      const tr = view.state.tr.delete($pos.pos, $pos.pos + nodeAt.nodeSize);
      view.dispatch(tr);
    }
  } catch (err) {
    console.error('Delete media node error:', err);
  }
  closeCtxMenu();
};

// Table context menu helpers
const closeTableCtxMenu = () => setTableCtxMenu(null);

const runTableCommand = (command: () => void) => {
  if (!editor || editor.isDestroyed) return;
  try {
    command();
  } catch (err) {
    console.error('Table command error:', err);
  }
  closeTableCtxMenu();
};

// Dismiss context menus on Escape or outside click
useEffect(() => {
  if (!ctxMenu && !tableCtxMenu) return;
  const onKey = (e: KeyboardEvent) => { 
    if (e.key === 'Escape') {
      closeCtxMenu();
      closeTableCtxMenu();
    }
  };
  const onDown = () => {
    closeCtxMenu();
    closeTableCtxMenu();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('mousedown', onDown);
  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onDown);
  };
}, [ctxMenu, tableCtxMenu]);

// ── Table + button click handler ────────────────────────────
// The CSS pseudo-elements for + buttons are positioned at cell edges.
// We detect clicks on the table and determine if they were in the button zone.
useEffect(() => {
  if (!editor || editor.isDestroyed) return;
  const editorEl = editor.view.dom as HTMLElement;
  
  const handleTableClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const cell = target.closest('td, th') as HTMLElement | null;
    if (!cell || !editor.isActive('table')) return;
    
    const rect = cell.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isRightEdge = x > rect.width - 20 && x <= rect.width + 20;
    const isBottomEdge = y > rect.height - 20 && y <= rect.height + 20;
    
    // Check if this cell is in the last row (for column add button)
    const row = cell.closest('tr');
    const table = row?.closest('table');
    const isLastRow = row && table ? row === table.querySelector('tr:last-child') : false;
    
    if (isRightEdge) {
      // Clicked on row add button
      e.preventDefault();
      e.stopPropagation();
      editor.chain().focus().addRowAfter().run();
    } else if (isBottomEdge && isLastRow) {
      // Clicked on column add button
      e.preventDefault();
      e.stopPropagation();
      editor.chain().focus().addColumnAfter().run();
    }
  };
  
  editorEl.addEventListener('click', handleTableClick);
  return () => editorEl.removeEventListener('click', handleTableClick);
}, [editor]);

  // ── Search: compute & highlight matches ─────────────────────────────
  const applySearchHighlights = useCallback((q: string, currentIndex: number) => {
    if (!editor || editor.isDestroyed) return;
    // We use CSS decoration approach via a stored array — no mark needed
    // Instead we scroll the current match into view via DOM
    const editorEl = editor.view.dom as HTMLElement;
    // Remove previous highlights
    editorEl.querySelectorAll('.search-highlight').forEach(el => {
      const text = document.createTextNode(el.textContent || '');
      el.replaceWith(text);
    });
    editorEl.querySelectorAll('.search-highlight-current').forEach(el => {
      const text = document.createTextNode(el.textContent || '');
      el.replaceWith(text);
    });
    // Normalize DOM after replacements
    editorEl.normalize();

    if (!q || q.trim() === '') {
      setSearchMatchCount(0);
      setSearchMatchIndex(0);
      return;
    }

    const lowerQ = q.toLowerCase();
    // Collect all text nodes in the editor
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: globalThis.Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as unknown as Text);

    let matches: HTMLElement[] = [];
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const lower = text.toLowerCase();
      let idx = 0;
      const parts: { start: number; end: number }[] = [];
      while ((idx = lower.indexOf(lowerQ, idx)) !== -1) {
        parts.push({ start: idx, end: idx + q.length });
        idx += q.length;
      }
      if (!parts.length) return;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      parts.forEach(({ start, end }) => {
        if (cursor < start) frag.appendChild(document.createTextNode(text.slice(cursor, start)));
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        matches.push(mark);
        cursor = end;
      });
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      textNode.replaceWith(frag);
    });

    setSearchMatchCount(matches.length);
    const safeIndex = matches.length > 0 ? Math.min(currentIndex, matches.length - 1) : 0;
    setSearchMatchIndex(safeIndex);

    if (matches.length > 0) {
      matches.forEach((m, i) => {
        m.className = i === safeIndex ? 'search-highlight search-highlight-current' : 'search-highlight';
      });
      matches[safeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [editor]);

  useEffect(() => {
    if (!showSearch) {
      // Clear highlights when panel is closed
      if (editor && !editor.isDestroyed) {
        const editorEl = editor.view.dom as HTMLElement;
        editorEl.querySelectorAll('.search-highlight, .search-highlight-current').forEach(el => {
          const text = document.createTextNode(el.textContent || '');
          el.replaceWith(text);
        });
        editorEl.normalize();
      }
      setSearchQuery('');
      setSearchMatchCount(0);
      setSearchMatchIndex(0);
    }
  }, [showSearch, editor]);

  useEffect(() => {
    applySearchHighlights(searchQuery, 0);
    setSearchMatchIndex(0);
  }, [searchQuery]);

  const navigateSearch = useCallback((direction: 'next' | 'prev') => {
    if (!editor || editor.isDestroyed) return;
    const editorEl = editor.view.dom as HTMLElement;
    const marks = Array.from(editorEl.querySelectorAll<HTMLElement>('.search-highlight'));
    if (!marks.length) return;
    const newIndex = direction === 'next'
      ? (searchMatchIndex + 1) % marks.length
      : (searchMatchIndex - 1 + marks.length) % marks.length;
    marks.forEach((m, i) => {
      m.className = i === newIndex ? 'search-highlight search-highlight-current' : 'search-highlight';
    });
    marks[newIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setSearchMatchIndex(newIndex);
  }, [editor, searchMatchIndex]);

  // ── Cmd+F to open search ──────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && currentTab) {
        // In split view both editors hear this — only the active one opens
        if (currentTab !== useStore.getState().activeTab) return;
        e.preventDefault();
        setShowSearch(true);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentTab]);

  // ── Zen mode: spawn floating particle on each keypress ──────────────
  useEffect(() => {
    if (!zenMode) return;
    const colors = ['#00c6ff', '#7c6dff', '#ff6bdf', '#ffe066', '#6dffc6'];
    const spawnParticle = (e: KeyboardEvent) => {
      if (e.key.length !== 1 && e.key !== 'Enter') return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const dot = document.createElement('div');
      dot.className = 'zen-particle';
      // Use position:fixed with viewport coords (getBoundingClientRect is already viewport-relative)
      dot.style.position = 'fixed';
      dot.style.left = `${rect.left + Math.random() * 10 - 5}px`;
      dot.style.top = `${rect.top - 4}px`;
      dot.style.color = colors[Math.floor(Math.random() * colors.length)];
      dot.style.background = dot.style.color;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 850);
    };
    document.addEventListener('keydown', spawnParticle);
    return () => document.removeEventListener('keydown', spawnParticle);
  }, [zenMode]);

  // ── Zen mode: typewriter scrolling — keep the caret vertically centered ──
  useEffect(() => {
    if (!zenMode || !editor || editor.isDestroyed) return;
    const centerCaret = () => {
      try {
        const view = editor.view;
        const coords = view.coordsAtPos(view.state.selection.head);
        // scope to THIS editor's scroller (split view has two)
        const scroller = view.dom.closest('.editor-scroll') as HTMLElement | null;
        if (!scroller) return;
        const rect = scroller.getBoundingClientRect();
        const delta = coords.top - (rect.top + rect.height / 2);
        if (Math.abs(delta) > 8) scroller.scrollTop += delta;
      } catch { /* editor transitioning */ }
    };
    editor.on('selectionUpdate', centerCaret);
    editor.on('update', centerCaret);
    return () => {
      editor.off('selectionUpdate', centerCaret);
      editor.off('update', centerCaret);
    };
  }, [zenMode, editor]);

  // Ref to track cleanup functions for tippy delegate & click handler
  const tippyCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    
    // Clean up previous tippy delegate if it exists (prevents leak on editor recreation)
    if (tippyCleanupRef.current) {
      tippyCleanupRef.current();
      tippyCleanupRef.current = null;
    }

    const instance = delegate(document.body, {
      target: '.wikilink-marker',
      content(reference) {
         const linkName = reference.getAttribute('data-target') || '';
         const file = allFilesRef.current.find(f => f.name.replace(/\.md$/, '').toLowerCase() === linkName.toLowerCase());
         if (file) {
           return `<div class="wiki-preview" data-target="${linkName}"><div class="wiki-preview-title">${file.name.replace(/\.md$/, '')}</div><div class="wiki-preview-subtitle">Click to jump to note</div></div>`;
         } else {
           return `<div class="wiki-preview" data-target="${linkName}"><div class="wiki-preview-title">${linkName}</div><div class="wiki-preview-subtitle">Note doesn't exist – click to create</div></div>`;
         }
      },
      allowHTML: true,
      theme: 'nopes',
      placement: 'top',
      interactive: false,
      delay: [50, 0],
      offset: [0, 8],
    });
    
    // Hard native mousedown listener to intercept before ProseMirror's mousedown handlers
    const handleGlobalClick = (e: MouseEvent) => {
      let target = e.target as HTMLElement;
      if (target && (target as any).nodeType === 3) target = target.parentElement as HTMLElement;
      if (!target || !target.closest) return;
      
      const marker = target.closest('.wikilink-marker');
      if (marker) {
         e.preventDefault();
         e.stopPropagation();
         
         const linkName = marker.getAttribute('data-target') || '';
         const file = allFilesRef.current.find(f => f.name.replace(/\.md$/, '').toLowerCase() === linkName.toLowerCase());
         
         if (file) {
           storeActionsRef.current.openFile(file.path);
         } else if (linkName) {
           storeActionsRef.current.createFile(linkName);
         }
      }
    };
    
    document.addEventListener('mousedown', handleGlobalClick, true);

    const cleanup = () => {
      instance.destroy();
      document.removeEventListener('mousedown', handleGlobalClick, true);
    };
    tippyCleanupRef.current = cleanup;

    return cleanup;
  }, [editor]);

  if (!currentTab) return null;

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <div className="editor-topbar-left">
          <FileText size={14} />
          <span className="editor-topbar-breadcrumb">{fileName}</span>
        </div>
        <div className="editor-topbar-right">
          <span className={`save-status ${saving ? 'saving' : ''}`}>{saving ? 'Saving…' : 'Saved'}</span>
          <button className="icon-btn sm" onClick={async (e) => { 
            e.preventDefault(); e.stopPropagation();
            const el = document.querySelector('.ProseMirror');
            if (!el) return;
            try {
              // Force print-friendly colors while html2canvas snapshots —
              // dark-theme text would otherwise render light-on-white.
              el.classList.add('pdf-export');

              // html2canvas can't render asset:// images (canvas taint →
              // blank export) — inline every vault image as a data URL first.
              const imageDataUrls = new Map<string, string>();
              const vault = useStore.getState().vaultPath;
              if (vault) {
                const sep = vault.includes('\\') ? '\\' : '/';
                const imgs = Array.from(el.querySelectorAll('img[data-rel-path]')) as HTMLElement[];
                for (const img of imgs) {
                  const rel = img.dataset.relPath!;
                  if (rel.startsWith('data:') || rel.startsWith('http')) continue;
                  try {
                    const bytes = await readFile(`${vault}${sep}${rel}`);
                    imageDataUrls.set(rel, bytesToDataUrl(bytes, rel));
                  } catch { /* missing file → placeholder in the clone */ }
                }
              }

              const opt = {
                margin: 10,
                filename: `${fileName}.pdf`,
                image: { type: 'jpeg' as const, quality: 0.98 },
                html2canvas: {
                  scale: 2,
                  useCORS: true,
                  // Swap unrenderable media (iframes/videos/asset imgs) in the
                  // CLONE html2canvas actually rasterizes.
                  onclone: (clonedDoc: Document) => prepareCloneForPdf(clonedDoc, imageDataUrls),
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
              };

              // Request raw ArrayBuffer to circumvent WKWebView Blob <a> tag blocking
              const pdfArrayBuffer = await html2pdf().set(opt as any).from(el as HTMLElement).outputPdf('arraybuffer');

              // Prompt user for save location
              const filePath = await save({
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
                defaultPath: `${fileName}.pdf`,
                title: 'Export Virtual PDF',
              });

              if (filePath) {
                const uint8Array = new Uint8Array(pdfArrayBuffer);
                await writeFile(filePath, uint8Array);
                import('react-hot-toast').then(m => m.toast.success('Successfully exported PDF!'));
              }
            } catch (err: any) {
              console.error("PDF Export failed", err);
              import('react-hot-toast').then(m => m.toast.error(`PDF export failed: ${err?.message ?? err}`));
            } finally {
              el.classList.remove('pdf-export');
            }
          }} title="Export to PDF (Print)">
            <Printer size={15} />
          </button>
          <VoiceMemoButton
            onResult={(transcript, audioRelPath) => {
              if (!editor || editor.isDestroyed) return;
              const parts = [
                transcript ? `> \u{1F399}\u{FE0F} ${transcript}` : null,
                `[voice memo](${audioRelPath})`,
              ].filter(Boolean).join('\n\n');
              editor.chain().focus('end').insertContent(`\n${parts}\n`).run();
            }}
          />
          <button
            className={`icon-btn sm ${showHistory ? 'is-active' : ''}`}
            title="Version history"
            onClick={() => setShowHistory(true)}
          >
            <History size={15} />
          </button>
          <button
            className={`icon-btn sm ${showSearch ? 'is-active' : ''}`}
            title="Find in note (⌘F)"
            onClick={() => setShowSearch(v => !v)}
          >
            <Search size={15}/>
          </button>
          <button
            className={`icon-btn sm ${zenMode ? 'is-active' : ''}`}
            title="Zen Mode (⌘⇧Z)"
            onClick={() => useStore.getState().setZenMode(!zenMode)}
          >
            <Focus size={15} />
          </button>
          <button className="icon-btn sm" title="More options"><MoreHorizontal size={16}/></button>
        </div>
      </div>

      {showSearch && (
        <SearchBar
          query={searchQuery}
          onQueryChange={q => setSearchQuery(q)}
          matchIndex={searchMatchIndex}
          matchCount={searchMatchCount}
          onPrev={() => navigateSearch('prev')}
          onNext={() => navigateSearch('next')}
          onClose={() => setShowSearch(false)}
        />
      )}

      <Toolbar
        editor={editor}
        onInsertImage={() => insertImage(editor)}
        onInsertLink={() => {
          if (!editor) return;
          setExistingLink(editor.getAttributes('link').href);
          setShowLinkModal(true);
        }}
      />
      <TableToolbar editor={editor} />

      <div 
        className="editor-scroll"
        onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('editor-scroll') || (e.target as HTMLElement).classList.contains('editor-body')) {
            editor?.commands.focus('end');
          }
        }}
      >
        <div
          className={`editor-body${isDragOver ? ' drag-over' : ''}${isImporting ? ' importing' : ''}${auraClass ? ' ' + auraClass : ''}${isTopSecret ? ' topsecret-blur' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
        >
          {isImporting && (
            <div className="import-overlay">
              <div className="import-spinner" />
              <span>Importing media…</span>
            </div>
          )}
          {stampLabel && (
            <div key={stampLabel} className="note-stamp" data-stamp={stampLabel}>{stampLabel}</div>
          )}
          <div className="note-title">{isTopSecret ? `🔒 ${fileName}` : fileName}</div>
          <PropertiesBar notePath={currentTab} />
          <EditorContent editor={editor} />
          
          {(backlinksFiles.length > 0 || unlinkedMentions.length > 0 || suggestedTags.length > 0 || suggestedLinks.length > 0) && (
            <div className="backlinks-pane">
              
              {(suggestedTags.length > 0 || suggestedLinks.length > 0) && (
                <div className="ai-tag-suggestions">
                  <div className="backlinks-header" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent)' }}>
                    <Sparkles size={12} /> AI Suggestions
                  </div>
                  {suggestedLinks.length > 0 && (
                    <div className="ai-links-row">
                      {suggestedLinks.map(sug => (
                        <span key={sug.path} className="ai-link-chip">
                          <button
                            className="ai-link-chip-main"
                            title={`Insert [[${sug.label}]] — related note (similarity ${(sug.score * 100).toFixed(0)}%)`}
                            onClick={() => {
                              if (editor) editor.chain().focus('end').insertContent(`\n[[${sug.label}]] `).run();
                              setSuggestedLinks(prev => prev.filter(x => x.path !== sug.path));
                            }}
                          >
                            <LinkIcon size={11} /> [[{sug.label}]]
                          </button>
                          <button
                            className="ai-link-chip-dismiss"
                            title="Don't suggest this link for this note again"
                            onClick={() => {
                              if (currentTab) addDismissed(currentTab, sug.path);
                              setSuggestedLinks(prev => prev.filter(x => x.path !== sug.path));
                            }}
                          >
                            <XIcon size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="ai-tags-row">
                    {suggestedTags.map(t => (
                      <button 
                        key={t} 
                        className="ai-tag-chip"
                        onClick={() => {
                          if (editor) editor.chain().focus('end').insertContent(`\n#${t} `).run();
                          setSuggestedTags(prev => prev.filter(x => x !== t));
                        }}
                      >
                        <Hash size={11} /> {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {backlinksFiles.length > 0 && (
                <>
                  <div className="backlinks-header">Linked Mentions</div>
                  {backlinksFiles.map(f => (
                    <div key={f.path} className="backlink-item" onClick={() => storeActionsRef.current.openFile(f.path)}>
                      <FileText size={14} /> <span>{f.name.replace(/\.md$/, '')}</span>
                    </div>
                  ))}
                </>
              )}
              {unlinkedMentions.length > 0 && (
                <>
                  <div className="backlinks-header" style={{ marginTop: backlinksFiles.length > 0 ? 12 : 0, color: 'var(--tx-3)' }}>Unlinked Mentions</div>
                  {unlinkedMentions.map(hit => (
                    <div key={hit.file.path} className="backlink-item unlinked">
                      <div className="backlink-item-main" onClick={() => storeActionsRef.current.openFile(hit.file.path)}>
                        <FileText size={14} style={{ opacity: 0.5 }} />
                        <span className="backlink-item-name">
                          {hit.file.name.replace(/\.md$/, '')}
                          {hit.count > 1 && <span className="backlink-count">×{hit.count}</span>}
                        </span>
                        <span className="backlink-snippet">{hit.snippet}</span>
                      </div>
                      <button
                        className="backlink-link-btn"
                        title={`Turn ${hit.count > 1 ? 'these mentions' : 'this mention'} into a [[wikilink]]`}
                        onClick={(e) => { e.stopPropagation(); linkMention(hit); }}
                      >
                        <LinkIcon size={11} /> Link
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showHistory && currentTab && (
        <HistoryModal notePath={currentTab} onClose={() => setShowHistory(false)} />
      )}

      {showLinkModal && (
        <LinkModal
          existing={existingLink}
          onConfirm={(url, text) => {
            if (!editor) return;
            if (editor.state.selection.empty && text) {
              // Insert as a text node with a link mark — interpolating
              // into an HTML string lets crafted text/URLs inject markup.
              editor.chain().focus().insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href: url } }],
              }).run();
            } else {
              editor.chain().focus().setLink({ href: url }).run();
            }
          }}
          onClose={() => setShowLinkModal(false)}
        />
      )}

      {/* ── Combo widget ── */}
      {zenMode && comboCount >= 5 && (() => {
        const tier = comboCount >= 100 ? 'supernova' : comboCount >= 50 ? 'flame' : 'spark';
        const label = tier === 'supernova' ? '🌟 SUPERNOVA' : tier === 'flame' ? '🔥 FLAME' : '✨ SPARK';
        return (
          <div className={`combo-widget ${tier}`}>
            <span className="combo-count">{comboCount}</span>
            <span className="combo-label">{label}</span>
          </div>
        );
      })()}

      {/* ── Media context menu ── */}
      {ctxMenu && (
        <div
          className="media-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="media-ctx-item media-ctx-delete"
            onClick={deleteMediaNode}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}

      {/* ── Table context menu ── */}
      {tableCtxMenu && (
        <div
          className="table-ctx-menu"
          style={{ top: tableCtxMenu.y, left: tableCtxMenu.x }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="table-ctx-section">
            <span className="table-ctx-label">Row</span>
            <button className="table-ctx-item" onClick={() => runTableCommand(() => editor?.chain().focus().addRowBefore().run())}>
              <ChevronUp size={12}/> Add Above
            </button>
            <button className="table-ctx-item" onClick={() => runTableCommand(() => editor?.chain().focus().addRowAfter().run())}>
              <ChevronDown size={12}/> Add Below
            </button>
            <button className="table-ctx-item table-ctx-delete" onClick={() => runTableCommand(() => editor?.chain().focus().deleteRow().run())}>
              <Trash size={12}/> Delete
            </button>
          </div>
          <div className="table-ctx-divider" />
          <div className="table-ctx-section">
            <span className="table-ctx-label">Column</span>
            <button className="table-ctx-item" onClick={() => runTableCommand(() => editor?.chain().focus().addColumnBefore().run())}>
              <ChevronLeft size={12}/> Add Left
            </button>
            <button className="table-ctx-item" onClick={() => runTableCommand(() => editor?.chain().focus().addColumnAfter().run())}>
              <ChevronRight size={12}/> Add Right
            </button>
            <button className="table-ctx-item table-ctx-delete" onClick={() => runTableCommand(() => editor?.chain().focus().deleteColumn().run())}>
              <Trash size={12}/> Delete
            </button>
          </div>
          <div className="table-ctx-divider" />
          <div className="table-ctx-section">
            <button className="table-ctx-item" onClick={() => runTableCommand(() => editor?.chain().focus().toggleHeaderRow().run())}>
              Toggle Header
            </button>
            <button className="table-ctx-item table-ctx-delete" onClick={() => runTableCommand(() => editor?.chain().focus().deleteTable().run())}>
              <Trash2 size={12}/> Delete Table
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const EditorComponent = NoteEditor;
