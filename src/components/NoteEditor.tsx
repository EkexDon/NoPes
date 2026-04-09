import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent, ReactRenderer, Extension } from '@tiptap/react';
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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, Link as LinkIcon,
  Image as ImageIcon, List, ListOrdered, Quote, Code, MoreHorizontal,
  Minus, FileText, Underline as UnderlineIcon, Palette, Sparkles, Hash, Trash2
} from 'lucide-react';
import { useStore, extractTags } from '../store/useStore';
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { AIService } from '../workers/AIService';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';

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

      return { dom };
    };
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
   Slash Commands
───────────────────────────────────────────── */
const COMMAND_ITEMS = [
  { title: 'Heading 1', icon: <Heading1 size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', icon: <Heading2 size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
  { title: 'Heading 3', icon: <Heading3 size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
  { title: 'Bold', icon: <Bold size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setMark('bold').run() },
  { title: 'Italic', icon: <Italic size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setMark('italic').run() },
  { title: 'Bullet List', icon: <List size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: 'Numbered List', icon: <ListOrdered size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: 'Quote', icon: <Quote size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: 'Code Block', icon: <Code size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: 'Divider', icon: <Minus size={14} />, command: ({ editor, range }: any) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
];

const SlashCommandList = React.forwardRef<any, any>((props, ref) => {
  const [sel, setSel] = useState(0);
  const pick = (i: number) => {
    const item = props.items[i];
    if (item) props.command(item);
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
        <button key={i} className={`suggestion-item ${i === sel ? 'is-selected' : ''}`} onClick={() => pick(i)} onMouseDown={e => e.preventDefault()}>
          <span style={{ marginRight: 6, display: 'flex', alignItems: 'center' }}>{item.icon}</span> {item.title}
        </button>
      ))}
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
   Main NoteEditor
───────────────────────────────────────────── */
export const NoteEditor: React.FC = () => {
  const { 
    allFiles, activeTab, tabContents, saveFile, openFile, createFile, graphData,
    pendingAssetInserts, setPendingAssetInserts, aiIndex 
  } = useStore();
  const [saving, setSaving] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [existingLink, setExistingLink] = useState<string | undefined>();
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState('idle');
  const allFilesRef = useRef(allFiles);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const storeActionsRef = useRef({ openFile, createFile });
  useEffect(() => { storeActionsRef.current = { openFile, createFile }; }, [openFile, createFile]);

  const content = activeTab ? (tabContents[activeTab] ?? '') : '';
  useEffect(() => { allFilesRef.current = allFiles; }, [allFiles]);

  const fileName = activeTab?.split('/').pop()?.replace(/\.md$/, '') ?? 'Untitled';
  const backlinks = graphData.links.filter(l => l.target === activeTab);
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
          if (h.score < 0.25 || h.path === activeTab) continue;
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
  }, [content, aiIndex, aiStatus, activeTab, tabContents]);

  const [unlinkedMentions, setUnlinkedMentions] = useState<typeof allFiles>([]);

  useEffect(() => {
    if (!activeTab || !fileName) {
      setUnlinkedMentions([]);
      return;
    }
    let cancel = false;
    const computeUnlinked = async () => {
      const mentions: typeof allFiles = [];
      const lowerName = fileName.toLowerCase();
      
      for (const f of allFiles) {
        if (f.path === activeTab) continue;
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
  }, [activeTab, fileName, allFiles, backlinksFiles, tabContents]);

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
        Underline,
        TextStyle,
        Color,
        NopesImage.configure({ allowBase64: true }),
        LinkExtension.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
        Markdown.configure({ transformCopiedText: false, transformPastedText: false }),
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
        if (!activeTab) return;
        const md = (editor.storage as any).markdown.getMarkdown();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        setSaving(true);
        saveTimerRef.current = setTimeout(() => {
          saveFile(activeTab, md).finally(() => setTimeout(() => setSaving(false), 600));
        }, 400);
      },
      editorProps: {},
    },
    [activeTab],
  );

  // Sync content when tab changes
  useEffect(() => {
    if (!editor) return;
    const curr = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
    if (curr !== content) {
      editor.commands.setContent(content, { emitUpdate: false } as any);
    }
  }, [activeTab, content]);

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

  if (!activeTab) return null;

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <div className="editor-topbar-left">
          <FileText size={14} />
          <span className="editor-topbar-breadcrumb">{fileName}</span>
        </div>
        <div className="editor-topbar-right">
          <span className={`save-status ${saving ? 'saving' : ''}`}>{saving ? 'Saving…' : 'Saved'}</span>
          <button className="icon-btn sm" title="More options"><MoreHorizontal size={16}/></button>
        </div>
      </div>

      <Toolbar
        editor={editor}
        onInsertImage={() => insertImage(editor)}
        onInsertLink={() => {
          if (!editor) return;
          setExistingLink(editor.getAttributes('link').href);
          setShowLinkModal(true);
        }}
      />

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
