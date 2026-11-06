import { expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { preserveEditorTypography, editorTypography } from './editor-typography';

function editorFor(html: string) {
  return new Editor({
    extensions: [StarterKit, TextStyleKit],
    content: preserveEditorTypography(html),
  });
}
const content =
  '<p style="font-family:Georgia,serif;font-size:11pt">Assinatura</p><p><span style="font-family:Arial,sans-serif;font-size:14px">Mensagem</span></p>';
it('acompanha o cursor e volta à formatação do texto após uma alteração manual', () => {
  const editor = editorFor(content);
  editor.commands.setTextSelection(2);
  expect(editorTypography(editor)).toEqual({ fontFamily: 'Georgia, serif', fontSize: '11pt' });
  editor.commands.setFontSize('20px');
  expect(editorTypography(editor).fontSize).toBe('20px');
  editor.commands.setTextSelection(14);
  expect(editorTypography(editor)).toEqual({ fontFamily: 'Arial, sans-serif', fontSize: '14px' });
  editor.commands.setTextSelection(3);
  expect(editorTypography(editor)).toEqual({ fontFamily: 'Georgia, serif', fontSize: '11pt' });
  editor.commands.insertContent('X');
  expect(editor.getHTML()).toContain('font-size: 11pt');
  editor.destroy();
});
it('indica formatação mista e aplica a nova fonte somente ao trecho selecionado', () => {
  const editor = editorFor(content);
  editor.commands.setTextSelection({ from: 2, to: 16 });
  expect(editorTypography(editor)).toEqual({ fontFamily: '', fontSize: '' });
  editor.commands.setFontFamily('Verdana, sans-serif');
  expect(editorTypography(editor).fontFamily).toBe('Verdana, sans-serif');
  expect(editorTypography(editor).fontSize).toBe('');
  editor.commands.setTextSelection(1);
  expect(editorTypography(editor).fontFamily).toBe('Georgia, serif');
  editor.destroy();
});
it('preserva imagens, links, texto e estilos internos sem executar ou importar conteúdo externo', () => {
  const html =
    '<div style="font-family:Georgia;font-size:11pt"><p>A <a href="https://example.test"><strong>B</strong></a><span style="font-size:18px">C</span></p><img data-apmail-cid="logo" alt="Logo"></div>';
  const normalized = preserveEditorTypography(html);
  const template = document.createElement('template');
  template.innerHTML = normalized;
  expect(template.content.textContent).toBe('A BC');
  expect(template.content.querySelector('img')?.getAttribute('data-apmail-cid')).toBe('logo');
  expect(template.content.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
  expect(template.content.querySelector('strong span')?.getAttribute('style')).toContain('11pt');
  expect(preserveEditorTypography(normalized)).toBe(normalized);
});
