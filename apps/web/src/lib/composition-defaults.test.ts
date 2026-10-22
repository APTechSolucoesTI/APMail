import { expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { DEFAULT_COMPOSITION_FORMAT } from '@apmail/shared';
import { CompositionDefaults, setCompositionFormat } from './composition-defaults';

it('keeps the personal font after clicking an empty paragraph, with manual overrides preserved', () => {
  const editor = new Editor({
    extensions: [
      StarterKit,
      TextStyleKit,
      CompositionDefaults.configure({
        format: {
          ...DEFAULT_COMPOSITION_FORMAT,
          font_family: 'Georgia, serif',
          font_size: 20,
          color: '#123456',
          bold: true,
        },
      }),
    ],
    content: '<p></p>',
  });
  editor.view.dispatch(editor.state.tr.setStoredMarks(null));
  editor.commands.insertContent('Texto pessoal');
  expect(editor.getHTML()).toContain('font-family: Georgia, serif');
  expect(editor.getHTML()).toContain('font-size: 20px');
  expect(editor.getHTML()).toContain('<strong>');
  editor.commands.unsetBold();
  editor.commands.setColor('#ff0000');
  editor.commands.insertContent(' Manual');
  expect(editor.getHTML()).toContain('color: rgb(255, 0, 0)');
  expect(editor.getHTML()).not.toContain('<strong> Manual');
  editor.destroy();
});
it('does not rewrite text or force a font when reopening a saved draft', () => {
  const editor = new Editor({
    extensions: [StarterKit, TextStyleKit, CompositionDefaults],
    content: '<p>Rascunho original</p>',
  });
  editor.view.dispatch(editor.state.tr.setStoredMarks(null));
  expect(editor.getHTML()).toBe('<p>Rascunho original</p>');
  editor.destroy();
});
it('updates defaults independently for each composer without changing existing text', () => {
  const create = () =>
    new Editor({ extensions: [StarterKit, TextStyleKit, CompositionDefaults], content: '<p></p>' });
  const first = create(),
    second = create();
  setCompositionFormat(first, { ...DEFAULT_COMPOSITION_FORMAT, font_family: 'Georgia, serif' });
  setCompositionFormat(second, {
    ...DEFAULT_COMPOSITION_FORMAT,
    font_family: 'Verdana, sans-serif',
  });
  first.commands.insertContent('Primeira caixa');
  second.commands.insertContent('Segunda caixa');
  expect(first.getHTML()).toContain('font-family: Georgia, serif');
  expect(second.getHTML()).toContain('font-family: Verdana, sans-serif');
  const snapshot = first.getHTML();
  setCompositionFormat(first, { ...DEFAULT_COMPOSITION_FORMAT, font_family: 'Tahoma, sans-serif' });
  expect(first.getHTML()).toBe(snapshot);
  first.destroy();
  second.destroy();
});
