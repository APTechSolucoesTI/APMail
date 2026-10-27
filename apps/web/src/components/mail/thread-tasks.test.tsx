import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { TenantContext } from '@/lib/auth';
import { ThreadTasks } from './thread-tasks';
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => []) }));
function open(role = 'member') {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], {
    user: { id: 'self', full_name: 'Ana' },
    tenants: [{ id: 'tenant', role }],
    preferences: { timezone: 'America/Sao_Paulo' },
  });
  client.setQueryData(
    ['calendar', 'tenant', 'thread-tasks', 'thread'],
    [
      {
        id: 'one',
        title: 'Conferir contrato',
        due_at: '2030-01-01T12:00:00Z',
        status: 'pending',
        user_id: 'other',
        assignee_name: 'José',
        notes: 'Conferir valor e vencimento',
      },
      {
        id: 'two',
        title: 'Enviar orçamento',
        due_at: '2030-01-01T12:00:00Z',
        status: 'completed',
        user_id: 'self',
        assignee_name: 'Ana',
        notes: '',
      },
    ],
  );
  return render(
    <QueryClientProvider client={client}>
      <TenantContext value="tenant">
        <ThreadTasks threadId="thread" mailboxId="box" subject="Revisar contrato" />
      </TenantContext>
    </QueryClientProvider>,
  );
}
it('lista tarefas, prazo, responsável e estado sem permitir alterar tarefa de outro membro', () => {
  open();
  expect(screen.getByText('Conferir contrato')).toBeVisible();
  expect(screen.getByText('Conferir valor e vencimento')).toBeVisible();
  expect(screen.getByText('Concluída')).toBeVisible();
  expect(screen.getByText('(1 pendente)')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument();
});
it('formulário exige título e oferece somente atribuição pessoal ao membro', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
  expect(screen.getByLabelText('Título')).toHaveValue('Revisar contrato');
  expect(screen.getByLabelText('Notas')).toBeVisible();
  expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }));
  expect(await screen.findByText('Informe o título.')).toBeVisible();
});
it('administrador pode editar e concluir tarefa atribuída a outro usuário', () => {
  open('admin');
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(screen.getByLabelText('Responsável')).toBeVisible();
  expect(screen.getByLabelText('Título')).toHaveValue('Conferir contrato');
});
