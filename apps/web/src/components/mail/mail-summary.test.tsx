import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SummaryPage } from '@/routes/_app.mail-summary';
const state = vi.hoisted(() => ({
  params: undefined as URLSearchParams | undefined,
  navigate: vi.fn(),
  search: {
    view: 'queue',
    queue: 'in_progress',
    mailboxId: '123e4567-e89b-42d3-a456-426614174000',
    status: 'in_progress',
    page: 1,
    pageSize: 50,
    sort: 'recent',
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
  meQuery: {
    queryKey: ['me'],
    queryFn: async () => ({ preferences: { mail_summary_enabled: true } }),
  },
}));
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => []) }));
vi.mock('@/components/mail/assignee-filter', () => ({ AssigneeFilter: () => null }));
vi.mock('@/hooks/use-mail-pages', () => ({
  MAIL_BULK_LIMIT: 100,
  useMailPages: ({ params }: { params: URLSearchParams }) => {
    state.params = params;
    return { data: { items: [], total: 0 }, isPending: false, isFetching: false, refetch: vi.fn() };
  },
}));
it('filtra status em caixa sem filas e não envia a visão de fila', () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], { preferences: { mail_summary_enabled: true } });
  render(
    <QueryClientProvider client={client}>
      <SummaryPage />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Filtrar status')).toBeVisible();
  expect(screen.getByLabelText('Filtrar status')).toHaveValue('in_progress');
  expect(state.params?.get('status')).toBe('in_progress');
  expect(state.params?.get('mailbox_id')).toBe(state.search.mailboxId);
  expect(state.params?.get('view')).toBe('folder');
  expect(state.params?.has('queue')).toBe(false);
  fireEvent.change(screen.getByLabelText('Filtrar status'), { target: { value: 'done' } });
  expect(state.navigate).toHaveBeenCalledWith({
    search: { ...state.search, status: 'done', page: 1 },
  });
});
