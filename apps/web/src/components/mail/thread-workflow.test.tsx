import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThreadWorkflow } from './thread-workflow';
import type { Thread } from '@/lib/mail';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/hooks/use-thread-presence', () => ({ useThreadPresence: () => [] }));
vi.mock('./thread-assignee', () => ({ ThreadAssignee: () => <button>Assumir</button> }));
const thread = {
  id: 'thread',
  queue_status: 'in_progress',
  queue_excluded: true,
  assigned_to: { id: 'user', full_name: 'Responsável QA' },
} as Thread;
function open(enabled?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], {
    user: { id: 'user' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', mail_queues_enabled: enabled }],
    preferences: { mail_queues_enabled: !enabled },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThreadWorkflow thread={thread} mailboxId="box" role="editor">
        <button>Organizar</button>
      </ThreadWorkflow>
    </QueryClientProvider>,
  );
}
it.each([true, undefined])(
  'preserva controles de atendimento quando a política da empresa é %s',
  (enabled) => {
    open(enabled);
    expect(screen.getByRole('button', { name: 'Assumir' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Status' })).toBeVisible();
    expect(screen.getByText('Responsável QA')).toBeVisible();
  },
);
it('desativar filas remove controles sem afetar ações de organização nem mudar a conversa', () => {
  vi.mocked(api).mockClear();
  open(false);
  expect(screen.queryByRole('button', { name: 'Assumir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
  expect(screen.queryByText('Responsável QA')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Esta conversa está fora das filas operacionais.'),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Organizar' }));
  expect(api).not.toHaveBeenCalled();
});
it('explica que tarefas pendentes impedem concluir o e-mail', () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], {
    user: { id: 'user' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', mail_queues_enabled: true }],
    preferences: {},
  });
  render(
    <QueryClientProvider client={client}>
      <ThreadWorkflow thread={{ ...thread, pending_task_count: 2 }} mailboxId="box" role="editor" />
    </QueryClientProvider>,
  );
  expect(
    screen.getByText('Conclua ou dispense as 2 tarefas pendentes antes de concluir a conversa.'),
  ).toBeVisible();
});
