import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { Attachment } from '@/lib/mail';
import { pendingSecurity } from '@/lib/antivirus';
import { AttachmentOfficePreview } from './attachment-office-preview';
import { ReceivedAttachment } from './attachment-safety';

vi.mock('@/lib/auth', () => ({
  useTenantId: () => 'tenant',
  useAccess: () => false,
  meQuery: { queryKey: ['me'], queryFn: async () => ({ preferences: {} }) },
}));
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({ id: null, status: 'pending' })) }));
afterEach(() => vi.unstubAllGlobals());

it('só oferece a prévia Office recebida após o veredito do antivírus', () => {
  const file: Attachment = {
    id: 'file',
    filename: 'Planilha.xlsx',
    content_type: 'application/zip',
    size_bytes: 1024,
    content_id: null,
    is_inline: false,
    security: pendingSecurity,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPreview = vi.fn();
  const view = (attachment: Attachment) => (
    <QueryClientProvider client={client}>
      <ul>
        <ReceivedAttachment attachment={attachment} onPreview={onPreview} />
      </ul>
    </QueryClientProvider>
  );
  const rendered = render(view(file));
  expect(
    screen.queryByRole('button', { name: 'Visualizar Planilha.xlsx' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Baixar Planilha.xlsx' })).not.toBeInTheDocument();
  rendered.rerender(view({ ...file, security: { ...pendingSecurity, status: 'clean' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Visualizar Planilha.xlsx' }));
  expect(onPreview).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'file', security: expect.objectContaining({ status: 'clean' }) }),
  );
  expect(screen.getByRole('link', { name: 'Baixar Planilha.xlsx' })).toHaveAttribute(
    'href',
    '/api/attachments/file/download',
  );
});

it('renderiza HTML recebido no CSV como texto e preserva a rota de download', async () => {
  const url = '/api/uploads/file/download';
  const fetchFile = vi.fn(
    async () => new Response('nome,valor\r\n<img src=x onerror=alert(1)>,=1+2'),
  );
  vi.stubGlobal('fetch', fetchFile);
  const view = render(
    <AttachmentOfficePreview filename="dados.csv" format="csv" downloadUrl={url} />,
  );
  expect(await screen.findByRole('cell', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '=1+2' })).toBeVisible();
  expect(view.container.querySelector('img,iframe,script')).toBeNull();
  expect(fetchFile).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }),
  );
  expect(screen.getByRole('link', { name: 'Baixar anexo' })).toHaveAttribute('href', url);
});
