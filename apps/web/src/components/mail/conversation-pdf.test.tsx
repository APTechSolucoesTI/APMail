import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConversationPdf } from './conversation-pdf';
import { renderPdfPreview, printPdfPages } from '@/lib/pdf-preview';
vi.mock('@/lib/pdf-preview', () => ({
  renderPdfPreview: vi.fn(async (_data, container) => {
    container.append(document.createElement('canvas'));
    return 1;
  }),
  printPdfPages: vi.fn().mockResolvedValue(undefined),
}));

it('previews the whole thread PDF and offers download and printing', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:conversation'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const { unmount } = render(<ConversationPdf threadId="thread-id" subject="Proposta" />);
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir conversa' }));
  const preview = await screen.findByRole('region', { name: 'Prévia do PDF da conversa' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir PDF' })).toBeEnabled());
  expect(preview.querySelector('canvas')).toBeInTheDocument();
  expect(renderPdfPreview).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(
    '/api/threads/thread-id/pdf',
    expect.objectContaining({ credentials: 'same-origin' }),
  );
  expect(screen.getByRole('link', { name: 'Baixar PDF' })).toHaveAttribute(
    'download',
    'apmail-conversa-thread-id.pdf',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir PDF' }));
  await waitFor(() => expect(printPdfPages).toHaveBeenCalledWith(preview, 'Proposta'));
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:conversation');
  vi.unstubAllGlobals();
});

it('keeps a readable error and retries PDF generation', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValue(
      new Response(new Blob(['pdf'], { type: 'application/pdf' }), {
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );
  vi.stubGlobal('fetch', fetch);
  render(<ConversationPdf threadId="id" />);
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir conversa' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível preparar');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir PDF' })).toBeEnabled());
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});
it('aborts an unfinished PDF request when the dialog is closed', async () => {
  let resolve: (value: Response) => void = () => {};
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const createUrl = vi.fn(() => 'blob:late');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  render(<ConversationPdf threadId="id" />);
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir conversa' }));
  expect(screen.getByRole('status')).toHaveTextContent('Preparando PDF');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  resolve(new Response(new Blob(['pdf']), { headers: { 'Content-Type': 'application/pdf' } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(createUrl).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
