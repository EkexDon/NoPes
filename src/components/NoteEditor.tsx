import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useEditor, EditorContent, ReactRenderer, Extension, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
import { Node } from '@tiptap/core';
import { FoldingExtension } from '../extensions/FoldingExtension';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import html2pdf from 'html2pdf.js';
import mermaid from 'mermaid';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, Link as LinkIcon,
  Image as ImageIcon, List, ListOrdered, Quote, Code, MoreHorizontal,
  Minus, FileText, Underline as UnderlineIcon, Palette, Sparkles, Hash, Trash2,
  Search, X as XIcon, ChevronUp, ChevronDown,
  Grid3x3, LayoutTemplate, GitBranch,
  RowsIcon, Columns, Trash, TableIcon, ChevronLeft, ChevronRight, Printer
} from 'lucide-react';
import { useStore, extractTags } from '../store/useStore';
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { AIService } from '../workers/AIService';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';

// Init mermaid once
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  darkMode: true,
  background: 'transparent' as any,
  fontFamily: 'Inter, sans-serif',
  fontSize: 14,
});

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
  return convertFileSrc(absPath);
};

const NopesImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const relPath = node.attrs.src || '';
      const isPdf  = /\.pdf$/i.test(relPath);
      const isVideo = /\.(mp4|webm|mov)$/i.test(relPath);

      let dom: HTMLElement;

      if (isPdf) {
        // ── PDF: full native iframe using WebKit's built-in PDF renderer ──
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin:1rem 0;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 30px rgba(0,0,0,0.4);';
        
        const iframe = document.createElement('iframe');
        iframe.src = resolveAssetSrc(relPath);
        iframe.style.cssText = 'width:100%;height:80vh;border:none;display:block;border-radius:8px;';
        iframe.setAttribute('title', relPath.split(/[\/\\]/).pop() || 'PDF');
        
        wrapper.appendChild(iframe);
        dom = wrapper;
      } else if (isVideo) {
        // ── Video: native <video> with controls ──────────────────────
        dom = document.createElement('video');
        const vid = dom as HTMLVideoElement;
        vid.src = resolveAssetSrc(relPath);
        vid.controls = true;
        vid.loop = false;
        vid.style.cssText = 'max-width:100%;border-radius:8px;margin:1rem 0;box-shadow:0 8px 30px rgba(0,0,0,0.4);display:block;';
      } else {
        // ── Image ────────────────────────────────────────────────────
        dom = document.createElement('img');
        const img = dom as HTMLImageElement;
        img.src = resolveAssetSrc(relPath);
        if (node.attrs.alt)   img.alt   = node.attrs.alt;
        if (node.attrs.title) img.title = node.attrs.title;
        img.style.cssText = 'max-width:100%;border-radius:8px;margin:1rem 0;box-shadow:0 8px 30px rgba(0,0,0,0.4);display:block;';
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
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showCode, setShowCode] = useState(false);
  const id = React.useId().replace(/:/g, '');

  useEffect(() => {
    let active = true;
    const renderDiagram = async () => {
      try {
        if (!code.trim()) { setSvg(''); setError(''); return; }
        const { svg: s } = await mermaid.render(`mermaid-${id}`, code);
        if (active) { setSvg(s); setError(''); }
      } catch (err: any) {
        if (active) setError(err.message || 'Syntax error');
      }
    };
    renderDiagram();
    return () => { active = false; };
  }, [code, id]);

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

const MermaidExtension = Node.create({
  name: 'mermaidNode',
  group: 'block',
  atom: true,
  addAttributes() {
    return { code: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'pre',
        getAttrs: (node: string | HTMLElement) => {
          const dom = node as HTMLElement;
          const codeEl = dom.querySelector('code');
          if (codeEl && codeEl.className.includes('language-mermaid')) {
             return { code: codeEl.textContent };
          }
          return false;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }: any) {
    return ['pre', {}, ['code', { class: 'language-mermaid' }, HTMLAttributes.code]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  }
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

const TEMPLATES: Record<string, string> = {
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
};

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
  { title: 'Bullet List',   group: 'Format', icon: <List size={14} />,         command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: 'Numbered List', group: 'Format', icon: <ListOrdered size={14} />,  command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: 'Quote',         group: 'Format', icon: <Quote size={14} />,        command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: 'Code Block',    group: 'Format', icon: <Code size={14} />,         command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: 'Divider',       group: 'Format', icon: <Minus size={14} />,        command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  // ─ Inserts
  { title: 'Table',         group: 'Insert', icon: <Grid3x3 size={14} />,      command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Mermaid Diagram', group: 'Insert', icon: <GitBranch size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertContent('```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Result 1]\n    B -->|No| D[Result 2]\n```\n').run() },
  // ─ Templates
  ...Object.entries(TEMPLATES).map(([title, content]) => ({
    title,
    group: 'Template',
    icon: <LayoutTemplate size={14} />,
    command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).insertContent(content + '\n').run(),
  })),
];

const SlashCommandList = React.forwardRef<any, any>((props, ref) => {
  const [sel, setSel] = useState(0);
  const pick = (i: number) => {
    const item = props.items[i];
    if (item && !item.isHeader) props.command(item);
  };
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
        defaultValue="16px"
        title="Font size"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => editor.chain().focus().setMark('textStyle', { fontSize: e.target.value }).run()}
      >
        {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
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
      <TBtn active={editor.isActive('table')} title="Insert table (3×3)" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Grid3x3 size={15}/></TBtn>
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
    pendingAssetInserts, setPendingAssetInserts, aiIndex 
  } = useStore();
  
  const currentTab = tabId || activeTab;
  const [saving, setSaving] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [existingLink, setExistingLink] = useState<string | undefined>();
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState('idle');
  const allFilesRef = useRef(allFiles);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── In-note search state ──────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const searchMatchesRef = useRef<{ from: number; to: number }[]>([]);

  const storeActionsRef = useRef({ openFile, createFile });
  useEffect(() => { storeActionsRef.current = { openFile, createFile }; }, [openFile, createFile]);

  const content = currentTab ? (tabContents[currentTab] ?? '') : '';
  useEffect(() => { allFilesRef.current = allFiles; }, [allFiles]);

  const fileName = currentTab?.split('/').pop()?.replace(/\.md$/, '') ?? 'Untitled';
  const backlinks = graphData.links.filter(l => l.target === currentTab);
  const backlinksFiles = backlinks.map(l => allFiles.find(f => f.path === l.source)).filter((f): f is any => Boolean(f));

  // AI Tag Suggestions
  useEffect(() => {
    const unsub = AIService.onStatus(setAiStatus);
    return unsub;
  }, []);

  useEffect(() => {
    if (aiStatus !== 'ready' || content.length < 50 || !aiIndex.length) return;
    const to = setTimeout(async () => {
      try {
        const qVec = await AIService.embedQuery(content);
        const hits = await AIService.search(qVec, aiIndex, 5);
        const tags = new Set<string>();
        for (const h of hits) {
          if (h.score < 0.25 || h.path === currentTab) continue;
          const text = tabContents[h.path];
          if (text) {
            extractTags(text).forEach(t => tags.add(t));
          }
        }
        const currentTags = new Set(extractTags(content));
        const newTags = Array.from(tags).filter(t => !currentTags.has(t)).slice(0, 4);
        setSuggestedTags(newTags);
      } catch {}
    }, 1500);
    return () => clearTimeout(to);
  }, [content, aiIndex, aiStatus, currentTab, tabContents]);

  const [unlinkedMentions, setUnlinkedMentions] = useState<typeof allFiles>([]);

  useEffect(() => {
    if (!currentTab || !fileName) {
      setUnlinkedMentions([]);
      return;
    }
    let cancel = false;
    const computeUnlinked = async () => {
      const mentions: typeof allFiles = [];
      const lowerName = fileName.toLowerCase();
      
      for (const f of allFiles) {
        if (f.path === currentTab) continue;
        if (backlinksFiles.find(b => b.path === f.path)) continue;
        
        let text = tabContents[f.path];
        if (text === undefined) {
           try { text = await readTextFile(f.path); } catch { text = ''; }
        }
        
        if (text.toLowerCase().includes(lowerName)) {
           mentions.push(f);
        }
      }
      if (!cancel) setUnlinkedMentions(mentions);
    };
    computeUnlinked();
    return () => { cancel = true; };
  }, [currentTab, fileName, allFiles, backlinksFiles, tabContents]);

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
        StarterKit,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        MermaidExtension,
        MathExtension.configure({ evaluation: false }),
        FoldingExtension,
        Underline,
        TextStyle,
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
      content,
      onUpdate: ({ editor }) => {
        if (!currentTab) return;
        const md = (editor.storage as any).markdown.getMarkdown();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        setSaving(true);
        saveTimerRef.current = setTimeout(() => {
          saveFile(currentTab, md).finally(() => setTimeout(() => setSaving(false), 600));
        }, 400);
      },
      editorProps: {
        attributes: {
          spellcheck: 'false',
        },
      },
    },
    [currentTab],
  );

  // Sync content when tab changes
  useEffect(() => {
    if (!editor) return;
    const curr = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
    if (curr !== content) {
      editor.commands.setContent(preprocessMath(content), { emitUpdate: false } as any);
    }
  }, [currentTab, content]);

  // Auto-insert dragged assets
  useEffect(() => {
  if (editor && pendingAssetInserts.length > 0) {
    pendingAssetInserts.forEach(pth => {
      // TipTap Image Extension syntax -> inserts the logical path natively into the doc.
      editor.chain().focus().setImage({ src: pth }).run();
    });
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

const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  setIsDragOver(false);
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const assetsDir = await join(useStore.getState().vaultPath || '', 'assets');
  if (!(await exists(assetsDir))) {
    await mkdir(assetsDir);
  }
  const newInserts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['png','jpg','jpeg','gif','webp','svg','mp4','webm','mov','pdf'].includes(ext)) continue;
    const arrayBuf = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    const uniqueName = `${Date.now()}_${file.name}`;
    const targetPath = await join(assetsDir, uniqueName);
    await writeFile(targetPath, uint8);
    const relPath = 'assets/' + uniqueName;
    newInserts.push(relPath);
    useStore.getState().addMedia({
      id: `${Date.now()}_${i}`,
      type: ['mp4','webm','mov'].includes(ext) ? 'video' : 'image',
      src: relPath,
    });
  }
  if (newInserts.length) {
    setPendingAssetInserts([...pendingAssetInserts, ...newInserts]);
  }
};

// ── Context menu for media elements ───────────────────────
type CtxMenu = { x: number; y: number; domNode: HTMLElement } | null;
const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);

const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
  const target = e.target as HTMLElement;
  // Walk up to find img / video / iframe
  const media = target.closest('img, video, iframe') as HTMLElement | null;
  if (!media) return; // not a media element — let browser handle it
  e.preventDefault();
  setCtxMenu({ x: e.clientX, y: e.clientY, domNode: media });
};

const closeCtxMenu = () => setCtxMenu(null);

const deleteMediaNode = () => {
  if (!editor || !ctxMenu) return;
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

// Dismiss context menu on Escape or outside click
useEffect(() => {
  if (!ctxMenu) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtxMenu(); };
  const onDown = () => closeCtxMenu();
  document.addEventListener('keydown', onKey);
  document.addEventListener('mousedown', onDown);
  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onDown);
  };
}, [ctxMenu]);

  // ── Search: compute & highlight matches ─────────────────────────────
  const applySearchHighlights = useCallback((q: string, currentIndex: number) => {
    if (!editor) return;
    const { tr, doc } = editor.state;
    // Clear existing search marks first via a fresh transaction
    const cleanTr = editor.state.tr;
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
      searchMatchesRef.current = [];
      return;
    }

    const lowerQ = q.toLowerCase();
    // Collect all text nodes in the editor
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

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
      if (editor) {
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
    if (!editor) return;
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
        e.preventDefault();
        setShowSearch(true);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentTab]);

  useEffect(() => {
    if (!editor) return;
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
      interactive: false, // Prevents the tooltip from being a separate "window" that steals mouse events
      delay: [50, 0],
      offset: [0, 8],
    });
    
    // Hard native mousedown listener to absolutely guarantee it intercepts before ProseMirror's mousedown handlers
    const handleGlobalClick = (e: MouseEvent) => {
      let target = e.target as HTMLElement;
      // Handle clicks on text nodes inside the marker
      if (target && (target as any).nodeType === 3) target = target.parentElement as HTMLElement;
      if (!target || !target.closest) return;
      
      const marker = target.closest('.wikilink-marker');
      if (marker) {
         console.log('--- WIKILINK MOUSEDOWN DETECTED ---');
         e.preventDefault();
         e.stopPropagation();
         
         const linkName = marker.getAttribute('data-target') || '';
         const file = allFilesRef.current.find(f => f.name.replace(/\.md$/, '').toLowerCase() === linkName.toLowerCase());
         
         console.log('Target:', linkName, 'Found file:', file?.path);
         
         if (file) {
           storeActionsRef.current.openFile(file.path);
         } else if (linkName) {
           storeActionsRef.current.createFile(linkName);
         }
      }
    };
    
    document.addEventListener('mousedown', handleGlobalClick, true);

    return () => {
      instance.destroy();
      document.removeEventListener('mousedown', handleGlobalClick, true);
    };
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
            try {
              const el = document.querySelector('.ProseMirror');
              if (!el) return;
              
              // Add a temporary print class to ensure dark mode text shows up or handle styling
              const opt = {
                margin: 10,
                filename: `${fileName}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
              };
              
              // Request raw ArrayBuffer to circumvent WKWebView Blob <a> tag blocking
              const pdfArrayBuffer = await html2pdf().set(opt).from(el).outputPdf('arraybuffer');
              
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
            } catch (err) {
              console.error("PDF Export failed", err);
            }
          }} title="Export to PDF (Print)">
            <Printer size={15} />
          </button>
          <button
            className={`icon-btn sm ${showSearch ? 'is-active' : ''}`}
            title="Find in note (⌘F)"
            onClick={() => setShowSearch(v => !v)}
          >
            <Search size={15}/>
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
          className={`editor-body${isDragOver ? ' drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
        >
          <div className="note-title">{fileName}</div>
          <EditorContent editor={editor} />
          
          {(backlinksFiles.length > 0 || unlinkedMentions.length > 0) && (
            <div className="backlinks-pane">
              
              {suggestedTags.length > 0 && (
                <div className="ai-tag-suggestions">
                  <div className="backlinks-header" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent)' }}>
                    <Sparkles size={12} /> AI Suggestions
                  </div>
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
                  {unlinkedMentions.map(f => (
                    <div key={f.path} className="backlink-item unlinked" onClick={() => storeActionsRef.current.openFile(f.path)}>
                      <FileText size={14} style={{ opacity: 0.5 }} /> <span style={{ opacity: 0.7 }}>{f.name.replace(/\.md$/, '')}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showLinkModal && (
        <LinkModal
          existing={existingLink}
          onConfirm={(url, text) => {
            if (!editor) return;
            if (editor.state.selection.empty && text) {
              editor.chain().focus().insertContent(`<a href="${url}">${text}</a>`).run();
            } else {
              editor.chain().focus().setLink({ href: url }).run();
            }
          }}
          onClose={() => setShowLinkModal(false)}
        />
      )}

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
    </div>
  );
};

export const EditorComponent = NoteEditor;
