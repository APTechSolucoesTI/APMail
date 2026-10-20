import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { RuleEditor } from './rule-management';
import { api } from '@/lib/api';
import type { Mailbox } from '@/lib/auth';
import type { MailRule } from '@/lib/organization';
vi.mock('@/lib/auth', () => ({
  useTenantId: () => 'tenant',
  useUserId: () => 'user',
  canMailbox: () => true,
  meQuery: {
    queryKey: ['me'],
    queryFn: async () => ({ preferences: { timezone: 'America/Sao_Paulo' } }),
  },
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
it('filtra etiquetas por observador sem apagar etiquetas globais do cache e testa por conversa', async () => {
  const id = '11111111-1111-4111-8111-111111111111',
    thread = '22222222-2222-4222-8222-222222222222';
  const labels = [
    { id: 'p', name: 'Pessoal', scope: 'personal', color: '#1686A7' },
    { id: 'g', name: 'Global', scope: 'tenant', color: '#1686A7' },
  ];
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith('/labels')) return labels;
    if (path.endsWith('/folders')) return [];
    if (path.includes('/threads?')) return { items: [{ id: thread, subject: 'Orçamento QA' }] };
    if (path === '/rules/preview') return { matches: true, conditions: [true] };
    if (path === '/tenant') return { settings: {} };
    return [];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rule: MailRule = {
    id: '',
    mailbox_id: id,
    scope: 'personal',
    name: 'Regra QA',
    is_active: true,
    priority: 100,
    match_mode: 'all',
    conditions: [{ field: 'subject', operator: 'contains', value: 'Orçamento' }],
    actions: [{ type: 'pin' }],
    stop_processing: false,
    created_at: '',
  };
  render(
    <QueryClientProvider client={client}>
      <RuleEditor
        rule={rule}
        boxes={[{ id, role: 'mailbox_admin', name: 'QA', receiving_protocol: 'pop3' } as Mailbox]}
        onClose={() => undefined}
        onSaved={async () => undefined}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(client.getQueryData(['labels', 'tenant', 'user', id])).toEqual(labels),
  );
  fireEvent.click(screen.getByText('Testar regra sem executar ações'));
  fireEvent.change(screen.getByLabelText('Testar em uma conversa recente'), {
    target: { value: thread },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Testar condições' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/rules/preview', {
      method: 'POST',
      body: expect.objectContaining({ thread_id: thread }),
    }),
  );
  expect(api).not.toHaveBeenCalledWith('/threads/' + thread);
  expect(client.getQueryData(['labels', 'tenant', 'user', id])).toEqual(labels);
});

it('todas as mensagens limpa filtros antigos; resposta automática salva conteúdo e desativa aplicação retroativa', async () => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/tenant' ? { settings: {} } : path.includes('/threads?') ? { items: [] } : [],
  );
  const id = '33333333-3333-4333-8333-333333333333';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={client}>
      <RuleEditor
        rule={{
          id: '',
          mailbox_id: id,
          scope: 'mailbox',
          name: 'Férias',
          is_active: true,
          priority: 100,
          match_mode: 'all',
          conditions: [{ field: 'from', operator: 'contains', value: '' }],
          actions: [{ type: 'mark_flagged' }],
          stop_processing: false,
          created_at: '',
        }}
        boxes={[{ id, name: 'QA', role: 'mailbox_admin', receiving_protocol: 'pop3' } as Mailbox]}
        onClose={() => undefined}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Quando corresponder a'), { target: { value: 'always' } });
  fireEvent.click(screen.getByText('Aplicar também às mensagens existentes'));
  fireEvent.change(screen.getByLabelText('Ação 1'), { target: { value: 'auto_reply' } });
  fireEvent.change(await screen.findByLabelText('Mensagem da resposta automática'), {
    target: { value: 'Olá, estou de férias até o próximo mês.' },
  });
  expect(screen.queryByText('Aplicar também às mensagens existentes')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/rules', {
      method: 'POST',
      body: expect.objectContaining({
        match_mode: 'always',
        conditions: [],
        apply_existing: false,
        actions: [
          expect.objectContaining({
            type: 'auto_reply',
            message: 'Olá, estou de férias até o próximo mês.',
            cooldown_hours: 168,
          }),
        ],
      }),
    }),
  );
  expect(onSaved).toHaveBeenCalledTimes(1);
});
