import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichTextEditor } from './rich-text-editor';

it('mostra a fonte e o tamanho herdados do HTML da assinatura', async () => {
  render(
    <RichTextEditor
      value={
        '<div data-apmail-signature="sig" style="font-family:Georgia,serif;font-size:11px"><p>Assinatura original</p></div>'
      }
      onChange={vi.fn()}
    />,
  );
  await screen.findByRole('textbox', { name: 'Mensagem' });
  expect(screen.getByRole('combobox', { name: 'Fonte' })).toHaveValue('Georgia, serif');
  expect(screen.getByRole('combobox', { name: 'Tamanho da fonte' })).toHaveValue('11px');
});

it('representa tamanhos em pontos e fontes fora da lista sem trocar pelo padrão', async () => {
  render(
    <RichTextEditor
      value={
        '<p><span style="font-family:Helvetica,sans-serif;font-size:11pt">Assinatura</span></p>'
      }
      onChange={vi.fn()}
    />,
  );
  await screen.findByRole('textbox', { name: 'Mensagem' });
  expect(screen.getByRole('combobox', { name: 'Fonte' })).toHaveValue('Helvetica,sans-serif');
  expect(screen.getByRole('combobox', { name: 'Tamanho da fonte' })).toHaveValue('11pt');
  expect(screen.getByRole('option', { name: '11 pt' })).toBeInTheDocument();
});

it('ativa a revisão nativa em português e preserva o menu de edição do navegador', async () => {
  const parent = vi.fn((event: React.MouseEvent) => event.preventDefault());
  render(
    <div onContextMenu={parent}>
      <RichTextEditor value="<p>Mensagem</p>" onChange={vi.fn()} />
    </div>,
  );
  const textbox = await screen.findByRole('textbox', { name: 'Mensagem' });
  expect(textbox).toHaveAttribute('spellcheck', 'true');
  expect(textbox).toHaveAttribute('lang', 'pt-BR');
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  textbox.dispatchEvent(event);
  expect(parent).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});
