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
