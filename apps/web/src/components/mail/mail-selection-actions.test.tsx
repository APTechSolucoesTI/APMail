import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { MailSelectionActions } from './mail-selection-actions';
import { api } from '@/lib/api';
import type { Mailbox } from '@/lib/auth';
import type { Thread } from '@/lib/mail';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/lib/auth', async (original) => ({
  ...(await original<object>()),
  useTenantId: () => 'tenant',
  useMailQueues: () => true,
  useAccess: () => true,
  meQuery: {
    queryKey: ['me'],
    queryFn: async () => ({ user: { id: 'me' }, preferences: {}, tenants: [] }),
  },
}));
vi.mock('./thread-tasks', () => ({ ThreadTasks: () => null }));
vi.mock('./thread-labels', () => ({ ThreadLabels: () => null }));
vi.mock('./conversation-pdf', () => ({ ConversationPdf: () => null }));
vi.mock('@/components/chat/share-to-chat-dialog', () => ({ ShareToChatDialog: () => null }));
const boxes = ['financeiro', 'comercial'].map((id) => ({
  id,
  name: id,
  email_address: id + '@empresa.test',
  role: 'mailbox_admin',
  permissions: undefined,
})) as Mailbox[];
const threads = boxes.map((box, i) => ({
  id: 'thread-' + i,
  mailbox_id: box.id,
  subject: 'Assunto ' + i,
  pending_task_count: 0,
})) as Thread[];
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) => (path === '/mailboxes' ? boxes : []));
});
function open(selected = threads) {
  const processed = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MailSelectionActions threads={selected} onProcessed={processed} />
    </QueryClientProvider>,
  );
  return processed;
}
it('assume a seleção em cada caixa original, sem misturar IDs entre empresas/caixas', async () => {
  const done = open();
  fireEvent.click(await screen.findByRole('button', { name: 'Assumir' }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(['thread-0', 'thread-1']));
  for (const [i, box] of boxes.entries())
    expect(api).toHaveBeenCalledWith('/mailboxes/' + box.id + '/threads/bulk', {
      method: 'POST',
      body: { thread_ids: ['thread-' + i], action: 'assign', user_id: 'me' },
    });
});
it('não oferece atribuição, status nem spam para caixa somente de leitura', async () => {
  vi.mocked(api).mockResolvedValue(boxes.map((box) => ({ ...box, role: 'viewer' })));
  open();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar lida' })).toBeEnabled());
  for (const name of ['Assumir', 'Atribuir responsável', 'Status', 'Organizar'])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});
it('preserva a seleção não processada quando outra caixa rejeita a ação', async () => {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/mailboxes') return boxes;
    if (options?.method === 'POST' && path.includes('comercial'))
      throw new Error('Este e-mail possui tarefas pendentes.');
    return [];
  });
  const done = open();
  const trigger = screen.getByRole('button', { name: 'Marcar lida' });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  await waitFor(() => expect(done).toHaveBeenCalledWith(['thread-0']));
  expect(screen.getByRole('alert')).toHaveTextContent('1 conversa(s) já foram atualizadas.');
});
