import { Node } from '@tiptap/core';

/**
 * Schema-level mermaid node — an ATOM with the diagram source stored in the
 * `code` attribute.
 *
 * Deliberately NOT a CodeBlock subclass: a code block keeps its source as
 * document TEXT, and a React node view without a NodeViewContent gives
 * ProseMirror no contentDOM — any DOM-sync re-parse then reads the rendered
 * SVG, finds no text, and silently erases the diagram source (real data
 * loss, observed in the wild). Atom + attrs is immune to that.
 *
 * The editor attaches its React node view via `.extend({ addNodeView })`;
 * this module stays free of React/Tauri imports so serialization can be
 * unit-tested headlessly.
 */
export const MermaidNode = Node.create({
  name: 'mermaidNode',
  group: 'block',
  atom: true,
  // Must outrank codeBlock's own <pre> parse rule so ```mermaid fences
  // become mermaid nodes instead of generic code blocks.
  priority: 1000,

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
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }: any) {
    return ['pre', {}, ['code', { class: 'language-mermaid' }, HTMLAttributes.code]];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write('```mermaid\n');
          state.text(node.attrs.code ?? '', false);
          state.write('\n```');
          state.closeBlock(node);
        },
      },
    };
  },
});
