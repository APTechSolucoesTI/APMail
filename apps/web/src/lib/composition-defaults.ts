import { Extension, type Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { CompositionFormat } from '@apmail/shared';

/** Defaults apply to empty writing paragraphs, never to existing content or signature text. */
const formatKey = new PluginKey<CompositionFormat | undefined>('compositionDefaults');
export function setCompositionFormat(editor: Editor, format: CompositionFormat | undefined) {
  const transaction = editor.state.tr.setMeta(formatKey, { format });
  if (format && !editor.state.selection.$from.parent.content.size) transaction.setStoredMarks(null);
  editor.view.dispatch(transaction);
}
export const CompositionDefaults = Extension.create<{ format: CompositionFormat | undefined }>({
  name: 'compositionDefaults',
  addOptions() {
    return { format: undefined };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: formatKey,
        state: {
          init: () => this.options.format,
          apply: (transaction, format) => {
            const meta = transaction.getMeta(formatKey) as
              { format: CompositionFormat | undefined } | undefined;
            return meta ? meta.format : format;
          },
        },
        appendTransaction: (_transactions, _previous, state) => {
          const format = formatKey.getState(state),
            position = state.selection.$from;
          if (
            !format ||
            !state.selection.empty ||
            state.storedMarks !== null ||
            !position.parent.isTextblock ||
            position.parent.content.size
          )
            return null;
          for (let depth = position.depth; depth > 0; depth--)
            if (position.node(depth).type.name === 'emailSignature') return null;
          const marks = [
            state.schema.marks.textStyle!.create({
              fontFamily: format.font_family,
              fontSize: `${format.font_size}px`,
              color: format.color,
            }),
          ];
          for (const name of ['bold', 'italic', 'underline', 'strike'] as const)
            if (format[name]) marks.push(state.schema.marks[name]!.create());
          return state.tr.setStoredMarks(marks);
        },
      }),
    ];
  },
});
