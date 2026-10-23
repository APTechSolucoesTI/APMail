import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MailboxDrafts } from './mailbox-drafts';
import { api } from '@/lib/api';
import { TenantContext } from '@/lib/auth';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('reopens a composer draft and views provider drafts without sending either', async () => {
  vi.mocked(api).mockResolvedValue({
    total: 2,
    items: [
      {
        id: 'mine',
        source: 'draft',
        subject: 'Proposta',
        to_addresses: [{ address: 'cliente@exemplo.com' }],
        snippet: 'Olá cliente',
        updated_at: '2026-10-23T12:00:00Z',
        can_edit: true,
      },
      {
        id: 'imported',
        source: 'message',
        thread_id: 'thread',
        subject: 'Outro rascunho',
        to_addresses: [],
        snippet: '',
        updated_at: '2026-10-22T12:00:00Z',
        can_edit: false,
      },
    ],
  });
  const onOpenDraft = vi.fn(),
    onOpenMessage = vi.fn(),
    onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me'], {
    user: { id: 'user' },
    preferences: { timezone: 'America/Sao_Paulo' },
  });
  render(
    <QueryClientProvider client={client}>
      <TenantContext.Provider value="tenant">
        <MailboxDrafts
          mailboxId="box"
          search={{ page: 1, pageSize: 10 }}
          onChange={onChange}
          onOpenDraft={onOpenDraft}
          onOpenMessage={onOpenMessage}
        />
      </TenantContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Editar rascunho: Proposta/ }));
  expect(onOpenDraft).toHaveBeenCalledWith('mine');
  fireEvent.click(screen.getByRole('button', { name: /Abrir rascunho: Outro rascunho/ }));
  expect(onOpenMessage).toHaveBeenCalledWith('thread', 'imported');
  fireEvent.change(screen.getByRole('combobox', { name: 'Rascunhos por página' }), {
    target: { value: '30' },
  });
  expect(onChange).toHaveBeenCalledWith({ pageSize: 30, page: 1 });
  expect(screen.getAllByRole('button', { name: /Excluir rascunho/ })).toHaveLength(1);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/mailboxes/box/drafts?page=1&page_size=10'),
  );
  expect(vi.mocked(api).mock.calls.every(([, options]) => !options)).toBe(true);
});
