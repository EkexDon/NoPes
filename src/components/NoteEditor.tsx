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
import { useStore } from '../store/useStore';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Link as LinkIcon, Image as ImageIcon, FileText,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code, Minus,
  MoreHorizontal, Palette,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

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
  const { allFiles, activeTab, tabContents, saveFile, openFile, createFile } = useStore();
  const [saving, setSaving] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [existingLink, setExistingLink] = useState<string | undefined>();
  const allFilesRef = useRef(allFiles);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const storeActionsRef = useRef({ openFile, createFile });
  useEffect(() => { storeActionsRef.current = { openFile, createFile }; }, [openFile, createFile]);

  const content = activeTab ? (tabContents[activeTab] ?? '') : '';
  useEffect(() => { allFilesRef.current = allFiles; }, [allFiles]);

  const insertImage = async (editor: ReturnType<typeof useEditor>) => {
    if (!editor) return;
    const selected = await open({ multiple: false, filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','gif','webp','svg'] }] });
    if (!selected) return;
    try {
      const bytes = await readFile(selected as string);
      const ext = (selected as string).split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const base64 = btoa(String.fromCharCode(...Array.from(bytes)));
      editor.chain().focus().setImage({ src: `data:${mime};base64,${base64}` }).run();
    } catch(e) { console.error('Image insert error:', e); }
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Underline,
        TextStyle,
        Color,
        Image.configure({ allowBase64: true }),
        LinkExtension.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
        Markdown.configure({ transformCopiedText: false, transformPastedText: false }),
        WikiLinkDecorator,
        WikiLinkExtension.configure({
          suggestion: {
            char: '[[',
            allowSpaces: true,
            startOfLine: false,
            command: ({ editor, range, props }: any) => {
              editor.chain().focus().deleteRange(range).insertContent(`[[${props.id}]]`).run();
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

  // Tippy delegation
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
  const fileName = activeTab.split('/').pop()?.replace(/\.md$/, '') ?? 'Untitled';

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

      <div className="editor-scroll">
        <div className="editor-body">
          <div className="note-title">{fileName}</div>
          <EditorContent editor={editor} />
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
    </div>
  );
};

export const EditorComponent = NoteEditor;
