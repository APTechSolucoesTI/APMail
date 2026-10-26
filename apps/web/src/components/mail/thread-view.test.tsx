import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TenantContext } from '@/lib/auth';
import { threadDetailKey, type Message, type ThreadDetail } from '@/lib/mail';
import { ThreadView } from './thread-view';

vi.mock('./thread-notes', () => ({ ThreadNotes: () => null }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  api: vi.fn(async () => ({})),
}));

function open(lastRead = '2026-10-26T12:00:00Z') {
  const messages: Message[] = ['Antigo', 'Intermediário', 'Recente'].map((name, index) => ({
    id: name,
    folder_id: 'inbox',
    subject: 'Conversa',
    direction: 'inbound',
    from_address: name.toLowerCase() + '@example.com',
    from_name: name,
    to_addresses: [],
    cc_addresses: [],
    reply_to_addresses: [],
    message_at: `2026-10-26T${String(9 + index).padStart(2, '0')}:00:00Z`,
    snippet: 'Resumo ' + name,
    body_text: 'Conteúdo ' + name,
    body_html: null,
    is_flagged: false,
    pending_action: false,
    attachments: [],
    sent_by: null,
  }));
  const data: ThreadDetail = {
    messages,
    labels: [],
    cid_map: {},
    pending_outbox: [],
    is_pinned: false,
    last_read_at: lastRead,
    my_role: 'viewer',
    thread: {
      id: 'thread',
      subject: 'Conversa',
      snippet: '',
      participants: [],
      message_count: 3,
      has_attachments: false,
      last_message_at: messages[2]!.message_at,
      last_inbound_at: messages[2]!.message_at,
      queue_status: 'done',
      is_unread: false,
      is_pinned: false,
      labels: [],
      assigned_to: null,
      is_overdue: false,
      has_scheduled: false,
      latest_from: { name: 'Recente', address: 'recente@example.com' },
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me'], {
    user: { id: 'viewer' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'member' }],
    preferences: {
      mail_queues_enabled: false,
      timezone: 'America/Sao_Paulo',
      load_remote_images: false,
    },
  });
  client.setQueryData(threadDetailKey('tenant', 'thread'), data);
  render(
    <QueryClientProvider client={client}>
      <TenantContext.Provider value="tenant">
        <ThreadView threadId="thread" mailboxId="box" folders={[]} onClose={() => undefined} />
      </TenantContext.Provider>
    </QueryClientProvider>,
  );
  return { client, messages };
}

it('mostra o mais recente primeiro e aberto, sem alterar o histórico usado pelas respostas', () => {
  const { client, messages } = open();
  const cards = within(screen.getByRole('region', { name: 'Conversa' })).getAllByRole('article');
  expect(
    cards.map((card) => within(card).getByText(/^(Antigo|Intermediário|Recente)$/).textContent),
  ).toEqual(['Recente', 'Intermediário', 'Antigo']);
  expect(
    within(cards[0]!).getByRole('button', { name: 'Recolher mensagem de Recente' }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect(
    within(cards[2]!).getByRole('button', { name: 'Expandir mensagem de Antigo' }),
  ).toHaveAttribute('aria-expanded', 'false');
  expect(client.getQueryData<ThreadDetail>(threadDetailKey('tenant', 'thread'))!.messages).toEqual(
    messages,
  );
  expect(messages[0]!.id).toBe('Antigo');
});

it('preserva a abertura das mensagens não lidas mesmo abaixo da mais recente', () => {
  open('2026-10-26T09:30:00Z');
  expect(
    screen.getByRole('button', { name: 'Recolher mensagem de Intermediário' }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Recolher mensagem de Recente' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Expandir mensagem de Antigo' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
