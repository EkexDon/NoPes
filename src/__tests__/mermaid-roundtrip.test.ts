/**
 * Regression: mermaid diagrams were silently erased because the old
 * implementation kept the source as codeBlock TEXT behind a React node view
 * with no contentDOM — DOM re-parse wiped it (` ```mermaid ` fences saved
 * back empty). The atom MermaidNode stores source in an attribute; these
 * tests drive a REAL editor through markdown → doc → markdown round trips.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { MermaidNode } from '../extensions/MermaidNode';
import { QueryBlockNode } from '../extensions/QueryBlock';

const DIAGRAM = `graph TD
    IDX[Vault Index] --> TD[Task Dashboard]
    GQC -->|unlocks| VW[Voice + Whisper]
    A[Start] --> B{Decision}`;

const NOTE = `# Roadmap

Some intro text.

\`\`\`mermaid
${DIAGRAM}
\`\`\`

Text after the diagram.
`;

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, MermaidNode, QueryBlockNode, Markdown],
    content,
  });
  return editor;
}

const md = (e: Editor) => (e.storage as any).markdown.getMarkdown() as string;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('mermaid round-trip', () => {
  it('parses a ```mermaid fence into a mermaidNode (not a codeBlock)', () => {
    const e = makeEditor(NOTE);
    let mermaidCount = 0, codeBlockCount = 0;
    e.state.doc.descendants(node => {
      if (node.type.name === 'mermaidNode') mermaidCount++;
      if (node.type.name === 'codeBlock') codeBlockCount++;
    });
    expect(mermaidCount).toBe(1);
    expect(codeBlockCount).toBe(0);
  });

  it('keeps the diagram source in the node attribute', () => {
    const e = makeEditor(NOTE);
    let code = '';
    e.state.doc.descendants(node => {
      if (node.type.name === 'mermaidNode') code = node.attrs.code;
    });
    expect(code.trim()).toBe(DIAGRAM);
  });

  it('serializes back to an intact ```mermaid fence', () => {
    const e = makeEditor(NOTE);
    const out = md(e);
    expect(out).toContain('```mermaid');
    expect(out).toContain('IDX[Vault Index] --> TD[Task Dashboard]');
    expect(out).toContain('B{Decision}');
    expect(out).toContain('Text after the diagram.');
  });

  it('is stable across repeated round trips', () => {
    let content = NOTE;
    for (let i = 0; i < 3; i++) {
      const e = makeEditor(content);
      content = md(e);
      e.destroy();
      editor = null;
    }
    expect(content).toContain('```mermaid');
    expect(content).toContain('A[Start] --> B{Decision}');
  });

  it('preserves special characters (arrows, angle brackets, pipes)', () => {
    const special = '```mermaid\ngraph TD\n    A[Line<br/>break] -->|label| B\n```\n';
    const e = makeEditor(special);
    const out = md(e);
    expect(out).toContain('A[Line<br/>break] -->|label| B');
  });

  it('regular fenced code blocks still round-trip as native codeBlocks', () => {
    const e = makeEditor('```js\nconst x = 1;\n```\n');
    let codeBlockCount = 0;
    e.state.doc.descendants(node => {
      if (node.type.name === 'codeBlock') codeBlockCount++;
    });
    expect(codeBlockCount).toBe(1);
    expect(md(e)).toContain('const x = 1;');
  });

  it('an empty mermaid fence survives without crashing', () => {
    const e = makeEditor('```mermaid\n```\n');
    expect(md(e)).toContain('```mermaid');
  });
});

describe('nopes-query round-trip (same atom-node pattern)', () => {
  it('parses a query fence into a queryBlock node with the query attr', () => {
    const e = makeEditor('```nopes-query\ntag=#project sort=name\n```\n');
    let attrs: any = null;
    e.state.doc.descendants(node => {
      if (node.type.name === 'queryBlock') attrs = node.attrs;
    });
    expect(attrs?.query).toBe('tag=#project sort=name');
  });

  it('serializes the fence back intact across round trips', () => {
    let content = 'before\n\n```nopes-query\nstatus=active limit=5\n```\n\nafter';
    for (let i = 0; i < 2; i++) {
      const e = makeEditor(content);
      content = md(e);
      e.destroy();
      editor = null;
    }
    expect(content).toContain('```nopes-query');
    expect(content).toContain('status=active limit=5');
    expect(content).toContain('before');
    expect(content).toContain('after');
  });
});

/* ── image embeds with spaces in filenames (the "![](assets/My File.pdf)" bug) ──
   Contract: srcs are stored percent-encoded in the document (markdown-safe,
   round-trip-stable with tiptap-markdown's built-in image serializer) and
   decoded only at file access. healMediaEmbeds repairs damaged notes. */
import Image from '@tiptap/extension-image';
import { encodeMediaSrc, safeDecodeSrc, sanitizeImportFileName, healMediaEmbeds } from '../extensions/imageMarkdown';

function makeImageEditor(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Image, Markdown],
    content,
  });
  return editor;
}

describe('media embeds with spaces round-trip (encoded contract)', () => {
  const RAW = 'assets/1783600497990_NoPes Engineering Roadmap.pdf';
  const ENC = encodeMediaSrc(RAW);

  it('encode/decode are inverse and idempotent', () => {
    expect(ENC).toBe('assets/1783600497990_NoPes%20Engineering%20Roadmap.pdf');
    expect(safeDecodeSrc(ENC)).toBe(RAW);
    expect(encodeMediaSrc(ENC)).toBe(ENC); // no double-encoding
  });

  it('an encoded embed is stable across THREE full round trips', () => {
    let content = `before\n\n![](${ENC})\n\nafter`;
    for (let i = 0; i < 3; i++) {
      const e = makeImageEditor(content);
      content = (e.storage as any).markdown.getMarkdown();
      e.destroy();
      editor = null;
    }
    expect(content).toContain(`![](${ENC})`);
    expect(content).not.toContain('\\[');    // never bracket-escaped
    expect(content).not.toContain('%2520');    // never double-encoded
    expect(content).toContain('before');
    expect(content).toContain('after');
  });

  it('spaceless srcs are untouched', () => {
    const e = makeImageEditor('![](assets/clip.mp4)');
    expect((e.storage as any).markdown.getMarkdown()).toContain('![](assets/clip.mp4)');
  });
});

describe('healMediaEmbeds', () => {
  it('repairs the bracket-escaped corpse from the wild', () => {
    const broken = '!\\[\\](assets/1783600497990_NoPes Engineering Roadmap.pdf)';
    const healed = healMediaEmbeds(broken);
    expect(healed).toBe('![](assets/1783600497990_NoPes%20Engineering%20Roadmap.pdf)');
  });

  it('encodes raw spaces in valid-looking embeds', () => {
    expect(healMediaEmbeds('![alt](assets/a b.pdf)')).toBe('![alt](assets/a%20b.pdf)');
  });

  it('leaves healthy embeds, prose, and code fences alone', () => {
    const md = 'text ![](assets/ok.png) more\n```\n![](assets/in code.pdf)\n```';
    expect(healMediaEmbeds(md)).toBe(md);
  });

  it('heals multiple embeds on one line', () => {
    const md = '![](assets/a b.png) and ![](assets/c d.png)';
    expect(healMediaEmbeds(md)).toBe('![](assets/a%20b.png) and ![](assets/c%20d.png)');
  });
});

describe('sanitizeImportFileName', () => {
  it('keeps spaces but strips markdown/FS hazards', () => {
    expect(sanitizeImportFileName('NoPes Engineering Roadmap.pdf')).toBe('NoPes Engineering Roadmap.pdf');
    expect(sanitizeImportFileName('bad<name>#1?.pdf')).toBe('bad_name__1_.pdf');
    expect(sanitizeImportFileName('a/b\\c.png')).toBe('a_b_c.png');
  });
});
