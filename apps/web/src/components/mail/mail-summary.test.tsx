import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Thread } from '@/lib/mail';
import { SummaryPage } from '@/routes/_app.mail-summary';

const state = vi.hoisted(() => ({
  params: undefined as URLSearchParams | undefined,
  navigate: vi.fn(),
  items: [] as Thread[],
  search: {
    view: 'queue',
    queue: 'in_progress',
    mailboxId: '123e4567-e89b-42d3-a456-426614174000',
    status: 'in_progress',
    page: 1,
    pageSize: 50,
    sort: 'waiting_longest',
  },
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<object>()),
  createFileRoute: () => () => ({
    useSearch: () => state.search,
    useNavigate: () => state.navigate,
  }),
}));
vi.mock('@/lib/auth', () => ({
  useTenantId: () => 'tenant',
  useMailQueues: () => false,
  meQuery: { queryKey: ['me'], queryFn: async () => ({}) },
}));
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => []) }));
vi.mock('@/components/mail/assignee-filter', () => ({ AssigneeFilter: () => null }));
vi.mock('./summary-conversation', () => ({
  SummaryConversation: ({ thread, onClose }: { thread: Thread; onClose: () => void }) => (
    <div role="dialog" aria-label={'Conversa da caixa ' + thread.mailbox_id}>
      <button onClick={onClose}>Fechar conversa</button>
    </div>
  ),
}));
vi.mock('./mail-context-menu', () => ({
  MailContextMenu: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./thread-list-item', () => ({
  ThreadListItem: ({ thread, onOpen }: { thread: Thread; onOpen: () => void }) => (
    <button onClick={onOpen}>{thread.subject}</button>
  ),
}));
vi.mock('@/hooks/use-mail-pages', () => ({
  MAIL_BULK_LIMIT: 100,
  useMailPages: ({ params }: { params: URLSearchParams }) => {
    state.params = params;
    return {
      data: { items: state.items, total: state.items.length },
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));

afterEach(() => {
  state.items = [];
  state.navigate.mockClear();
});
function openSummary() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], {
    user: { id: 'user' },
    preferences: { mail_summary_enabled: true },
  });
  render(
    <QueryClientProvider client={client}>
      <SummaryPage />
    </QueryClientProvider>,
  );
}
it('ignora filtros e ordenação de fila ao abrir o Resumo de uma caixa sem filas', () => {
  openSummary();
  expect(screen.queryByLabelText('Filtrar status')).not.toBeInTheDocument();
  expect(state.params?.has('status')).toBe(false);
  expect(state.params?.get('sort')).toBe('recent');
  expect(state.params?.get('mailbox_id')).toBe(state.search.mailboxId);
  expect(state.params?.get('view')).toBe('folder');
  expect(state.params?.has('queue')).toBe(false);
});
it('abre a conversa da caixa de origem e volta aos mesmos resultados sem navegar', () => {
  state.items = [
    { id: 'thread', mailbox_id: state.search.mailboxId, subject: 'Conversa de suporte' },
  ] as Thread[];
  openSummary();
  fireEvent.click(screen.getByRole('button', { name: 'Conversa de suporte' }));
  expect(
    screen.getByRole('dialog', { name: 'Conversa da caixa ' + state.search.mailboxId }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Fechar conversa' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conversa de suporte' })).toBeVisible();
  expect(state.params?.get('assigned')).toBe('any');
  expect(state.navigate).not.toHaveBeenCalled();
});
