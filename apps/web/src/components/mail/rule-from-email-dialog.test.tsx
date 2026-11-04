import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuleFromEmailDialog } from './rule-from-email-dialog';
import type { Mailbox } from '@/lib/auth';
import type { Thread } from '@/lib/mail';
import { api } from '@/lib/api';
const access = vi.hoisted(() => ({ rules: true }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/lib/auth', async (original) => ({
  ...(await original<typeof import('@/lib/auth')>()),
  useTenantId: () => 'tenant',
  useUserId: () => 'user',
  useAccess: () => access.rules,
  meQuery: {
    queryKey: ['me'],
    queryFn: async () => ({ preferences: { timezone: 'America/Sao_Paulo' } }),
  },
}));
const id = '123e4567-e89b-42d3-a456-426614174000';
const mailbox: Mailbox = {
  id,
  name: 'Comercial',
  role: 'viewer',
  email_address: 'box@example.com',
  aliases: [],
  receiving_protocol: 'pop3',
  permissions: ['read'],
  status: 'active',
  last_error: null,
  last_synced_at: null,
  from_name_template: '',
  append_sent_copy: true,
};
const thread: Thread = {
  id,
  subject: 'Proposta',
  snippet: '',
  participants: [],
  message_count: 1,
  has_attachments: false,
  last_message_at: null,
  last_inbound_at: null,
  queue_status: 'none',
  is_unread: false,
  is_pinned: false,
  labels: [],
  assigned_to: null,
  is_overdue: false,
  has_scheduled: false,
  latest_from: { address: ' ANA@EXAMPLE.COM ', name: 'Ana' },
  direction: 'inbound',
};
let saved: unknown;
beforeEach(() => {
  access.rules = true;
  saved = undefined;
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path, options) => {
      if (path === '/tenant') return { settings: {} };
      if (path.includes('/threads?')) return { items: [] };
      if (path === '/rules' && options?.method === 'POST') {
        saved = options.body;
        return { id };
      }
      return [];
    });
});
function open(box = mailbox, source = thread) {
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RuleFromEmailDialog mailbox={box} thread={source} onClose={close} />
    </QueryClientProvider>,
  );
  return close;
}
it('cria regra pessoal do remetente sem abrir mensagem ou aplicar retroativamente', async () => {
  const close = open();
  expect(screen.getByRole('heading', { name: 'Criar regra deste remetente' })).toBeVisible();
  expect(screen.getByLabelText('Campo 1')).toHaveValue('from');
  expect(screen.getByLabelText('Operador 1')).toHaveValue('equals');
  expect(screen.getByLabelText('Valor 1')).toHaveValue('ana@example.com');
  expect(screen.queryByLabelText('Escopo da regra')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
  await waitFor(() =>
    expect(saved).toMatchObject({
      scope: 'personal',
      actions: [{ type: 'pin' }],
      conditions: [{ field: 'from', operator: 'equals', value: 'ana@example.com' }],
      apply_existing: false,
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(vi.mocked(api).mock.calls.some(([path]) => path === '/threads/' + id)).toBe(false);
});
it('permite escolher destinatário enviado e regra da caixa somente com permissão', async () => {
  open(
    { ...mailbox, role: 'mailbox_admin', permissions: ['read', 'rules', 'organize'] },
    {
      ...thread,
      direction: 'outbound',
      latest_to: [
        { name: 'Ana', address: 'ana@example.com' },
        { name: 'Bruno', address: 'BRUNO@example.com' },
      ],
    },
  );
  expect(screen.getByRole('heading', { name: 'Criar regra deste destinatário' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Destinatário da regra'), {
    target: { value: 'bruno@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Escopo da regra'), { target: { value: 'mailbox' } });
  expect(screen.getByLabelText('Campo 1')).toHaveValue('to');
  expect(screen.getByLabelText('Valor 1')).toHaveValue('bruno@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
  await waitFor(() =>
    expect(saved).toMatchObject({
      scope: 'mailbox',
      actions: [{ type: 'mark_flagged' }],
      conditions: [{ field: 'to', operator: 'equals', value: 'bruno@example.com' }],
      apply_existing: false,
    }),
  );
});
it('bloqueia o editor sem permissão de regras', () => {
  access.rules = false;
  open();
  expect(screen.getByRole('heading', { name: 'Sem permissão' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Salvar regra' })).not.toBeInTheDocument();
});
