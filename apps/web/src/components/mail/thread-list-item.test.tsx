import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { TenantContext, type Mailbox } from '@/lib/auth';
import type { Thread } from '@/lib/mail';
import { ThreadListItem } from './thread-list-item';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  api: vi.fn(async () => ({})),
}));

const thread: Thread = {
  id: 'thread',
  message_id: 'message',
  subject: 'Proposta',
  snippet: 'Pauta',
  participants: [],
  message_count: 1,
  has_attachments: false,
  last_message_at: null,
  last_inbound_at: null,
  queue_status: 'none',
  is_unread: false,
  is_pinned: true,
  is_pinned_global: true,
  is_pinned_personal: false,
  is_flagged: true,
  has_reply: true,
  labels: [],
  assigned_to: null,
  is_overdue: false,
  has_scheduled: false,
  latest_from: { name: 'Ana', address: 'ana@qa.test' },
};
function open(
  mailbox: Pick<Mailbox, 'id' | 'role' | 'permissions' | 'queues_enabled'>,
  item = thread,
) {
  vi.mocked(api).mockClear();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['me'], {
    user: { id: 'person' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'owner', mail_queues_enabled: false }],
    preferences: {},
  });
  const onOpen = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TenantContext.Provider value="tenant">
        <ThreadListItem
          thread={item}
          mailbox={mailbox as Mailbox}
          selected={false}
          active={false}
          onSelect={vi.fn()}
          onOpen={onOpen}
        />
      </TenantContext.Provider>
    </QueryClientProvider>,
  );
  return onOpen;
}
it('targets exact message for flag and keeps personal pin separate from global pin', async () => {
  const onOpen = open({
    id: 'box',
    role: 'mailbox_admin',
    permissions: ['read', 'organize', 'flag'],
  });
  expect(screen.getByRole('article')).toHaveAttribute('data-flagged', 'true');
  expect(screen.getByRole('img', { name: 'Resposta enviada' })).toBeVisible();
  const flag = screen.getByRole('button', { name: 'Remover sinalização' });
  expect(flag).toHaveAttribute('aria-pressed', 'true');
  await act(async () => {
    fireEvent.click(flag);
  });
  expect(api).toHaveBeenCalledWith('/mailboxes/box/messages/actions', {
    method: 'POST',
    body: { type: 'set_flag', message_ids: ['message'], flagged: false },
  });
  const pin = screen.getByRole('button', { name: 'Fixar conversa para mim' });
  expect(pin).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(pin);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/threads/thread/pin', {
      method: 'POST',
      body: { scope: 'personal' },
    }),
  );
  expect(onOpen).not.toHaveBeenCalled();
});
it('offers personal pin with read access and hides flag when effective permission denies it', () => {
  open(
    { id: 'box', role: 'mailbox_admin', permissions: ['read'] },
    { ...thread, is_flagged: false, is_pinned_personal: true },
  );
  expect(screen.queryByRole('button', { name: /sinaliza/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Desafixar conversa para mim' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('article')).not.toHaveAttribute('data-flagged');
});

it('oculta status e alerta de SLA de uma caixa sem filas, inclusive em uma lista mista', () => {
  open(
    { id: 'box', role: 'viewer', queues_enabled: false },
    {
      ...thread,
      queues_enabled: true,
      queue_status: 'to_reply',
      is_overdue: true,
      is_assignee_overdue: true,
    },
  );
  expect(screen.queryByText('A responder')).not.toBeInTheDocument();
  expect(screen.queryByText(/Fora do SLA/)).not.toBeInTheDocument();
});
