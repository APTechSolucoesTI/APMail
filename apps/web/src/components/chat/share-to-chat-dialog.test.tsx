import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ShareToChatDialog } from './share-to-chat-dialog';
import { api } from '@/lib/api';
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  meQuery: { queryKey: ['me'], queryFn: async () => ({ user: { id: 'me' } }) },
}));
vi.mock('@/hooks/use-chat', () => ({
  useChatConversations: () => ({
    data: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        type: 'group',
        name: 'Equipe',
        participants: [],
      },
    ],
  }),
}));
vi.mock('./people-picker', () => ({
  useChatPeople: () => ({ data: [] }),
  PeopleQueryState: () => null,
  PeoplePicker: () => null,
}));
it('compartilha cada conversa selecionada e preserva os identificadores ao repetir após falha parcial', async () => {
  const ids = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
  let attempt = 0;
  vi.mocked(api).mockImplementation(async () => {
    if (++attempt === 2) throw new Error('Tente novamente.');
    return {};
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ShareToChatDialog threadId={ids[0]!} threadIds={ids} iconOnly />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compartilhar no chat' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Equipe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compartilhar e-mails' }));
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Compartilhar e-mails' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compartilhar e-mails' }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(4));
  const payloads = vi
    .mocked(api)
    .mock.calls.map((call) => call[1]?.body as { thread_id: string; client_id: string });
  expect(payloads.map((payload) => payload.thread_id)).toEqual([...ids, ...ids]);
  expect(payloads[0]!.client_id).toBe(payloads[2]!.client_id);
  expect(payloads[1]!.client_id).toBe(payloads[3]!.client_id);
  expect(payloads[0]!.client_id).not.toBe(payloads[1]!.client_id);
});
