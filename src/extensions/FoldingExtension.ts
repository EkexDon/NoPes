import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const foldingKey = new PluginKey<Set<number>>('folding');

export const FoldingExtension = Extension.create({
  name: 'folding',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: foldingKey,

        state: {
          init: () => new Set<number>(),
          apply(tr, foldedSet) {
            const meta = tr.getMeta(foldingKey);
            if (meta) {
              const newSet = new Set(foldedSet);
              if (newSet.has(meta.pos)) {
                newSet.delete(meta.pos);
              } else {
                newSet.add(meta.pos);
              }
              return newSet;
            }
            return foldedSet;
          },
        },

        props: {
          decorations(state) {
            const foldedSet = foldingKey.getState(state) ?? new Set<number>();
            const { doc } = state;
            const decorations: Decoration[] = [];

            // Track which heading positions are folded and need to hide content below
            const foldRanges: { from: number; to: number }[] = [];

            doc.forEach((node, offset) => {
              if (!node.type.name.startsWith('heading')) return;

              const pos = offset;
              const headingLevel = node.attrs.level as number;
              const isFolded = foldedSet.has(pos);

              // Find the range that should be folded
              if (isFolded) {
                let endPos = doc.content.size;
                doc.forEach((n, o) => {
                  if (o <= pos) return;
                  if (
                    n.type.name.startsWith('heading') &&
                    (n.attrs.level as number) <= headingLevel
                  ) {
                    endPos = Math.min(endPos, o);
                  }
                });
                if (endPos > pos + node.nodeSize) {
                  foldRanges.push({ from: pos + node.nodeSize, to: endPos });
                }
              }

              // Widget: fold toggle button — rendered directly via DOM
              const toggleWidget = Decoration.widget(
                pos + 1,
                (view, getPos) => {
                  const btn = document.createElement('button');
                  btn.className = 'fold-toggle';
                  btn.title = isFolded ? 'Expand section' : 'Collapse section';
                  btn.setAttribute('contenteditable', 'false');
                  btn.innerHTML = isFolded
                    ? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`
                    : `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

                  btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const resolvedPos = typeof getPos === 'function' ? getPos() : pos;
                    // getPos() returns pos inside the node, so we go back to node start
                    const nodeStart = (resolvedPos ?? pos) - 1;
                    const tr = view.state.tr.setMeta(foldingKey, { pos: nodeStart });
                    view.dispatch(tr);
                  });

                  return btn;
                },
                { side: -1, key: `fold-toggle-${pos}-${isFolded}` }
              );

              decorations.push(toggleWidget);
            });

            // Apply hide decorations
            for (const range of foldRanges) {
              // We can't truly hide with node decorations on block-level without hacks,
              // so we use an inline decoration class on each node in the range
              doc.nodesBetween(range.from, range.to, (node, pos) => {
                if (pos < range.from || pos >= range.to) return;
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'folded-block',
                  })
                );
              });
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
