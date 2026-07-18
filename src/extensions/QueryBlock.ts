import { Node } from '@tiptap/core';

/**
 * ```nopes-query``` blocks as ATOM nodes with the query in an attribute —
 * same pattern (and same data-loss rationale) as MermaidNode. The React
 * node view is attached in NoteEditor; this module stays headlessly
 * testable.
 */
export const QueryBlockNode = Node.create({
  name: 'queryBlock',
  group: 'block',
  atom: true,
  priority: 1000, // outrank codeBlock's <pre> rule

  addAttributes() {
    return { query: { default: '' } };
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        getAttrs: (node: string | HTMLElement) => {
          const dom = node as HTMLElement;
          const codeEl = dom.querySelector('code');
          if (codeEl && codeEl.className.includes('language-nopes-query')) {
            return { query: codeEl.textContent?.trim() ?? '' };
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }: any) {
    return ['pre', {}, ['code', { class: 'language-nopes-query' }, HTMLAttributes.query]];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write('```nopes-query\n');
          state.text(node.attrs.query ?? '', false);
          state.write('\n```');
          state.closeBlock(node);
        },
      },
    };
  },
});
