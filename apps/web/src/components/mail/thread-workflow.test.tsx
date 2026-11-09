import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThreadWorkflow } from './thread-workflow';
import type { Thread } from '@/lib/mail';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({})) }));
vi.mock('@/hooks/use-thread-presence', () => ({ useThreadPresence: () => [] }));
vi.mock('./thread-assignee', () => ({ ThreadAssignee: () => <button>Atribuir</button> }));
vi.mock('./thread-invitations', () => ({ ThreadInvitations: () => <button>Convidar</button> }));
const thread = {
  id: 'thread',
  queue_status: 'to_reply',
  assigned_to: { id: 'user', full_name: 'Responsável QA' },
} as Thread;
function open(
  patch: Partial<Thread> = {},
  delegated = false,
  role: 'editor' | 'viewer' = 'editor',
) {
  vi.mocked(api).mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], {
    user: { id: 'user' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', mail_queues_enabled: false }],
    preferences: {},
  });
  return render(
    <QueryClientProvider client={client}>
      <ThreadWorkflow
        thread={{ ...thread, ...patch }}
        mailboxId="box"
        role={role}
        queuesEnabled={patch.queues_enabled !== false}
        delegated={delegated}
      />
    </QueryClientProvider>,
  );
}
it('oculta todo o atendimento quando as filas da caixa estão desativadas', () => {
  open({ queues_enabled: false, pending_task_count: 1 });
  expect(screen.queryByRole('group', { name: 'Ações da conversa' })).not.toBeInTheDocument();
  expect(screen.queryByText('Responsável QA')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('permite iniciar atendimento com as filas da caixa ativadas', async () => {
  open();
  expect(screen.getByRole('button', { name: 'Atribuir' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeVisible();
  expect(screen.getByText('Responsável QA')).toBeVisible();
  expect(screen.queryByText('Excluir das filas')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/threads/thread/start', { method: 'POST' }),
  );
});
it('conversa concluída oferece somente reabrir', async () => {
  open({ queue_status: 'done' });
  expect(screen.queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Iniciar atendimento' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/threads/thread/reopen', { method: 'POST' }),
  );
});
it('não oferece iniciar para atendimento já iniciado', () => {
  open({ service_started_at: '2026-11-06T12:00:00Z' });
  expect(screen.queryByRole('button', { name: 'Iniciar atendimento' })).not.toBeInTheDocument();
});
it('convidado atende sem atribuir ou convidar outras pessoas', () => {
  open({}, true);
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Atribuir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Convidar' })).not.toBeInTheDocument();
});
it('visualizador não recebe controles de atendimento', () => {
  open({}, false, 'viewer');
  expect(screen.queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Iniciar atendimento' })).not.toBeInTheDocument();
});
it('tarefas pendentes bloqueiam concluir com explicação', () => {
  open({ pending_task_count: 2 });
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeDisabled();
  expect(
    screen.getByText('Conclua ou dispense as 2 tarefas pendentes antes de concluir a conversa.'),
  ).toBeVisible();
});
