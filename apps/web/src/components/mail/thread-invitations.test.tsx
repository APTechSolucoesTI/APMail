import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { ThreadInvitations } from './thread-invitations';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
it('convida e encerra acesso somente na conversa selecionada', async () => {
  vi.mocked(api).mockImplementation(async (path, options) =>
    options?.method
      ? {}
      : {
          items: [{ id: 'invitation', state: 'active', full_name: 'Convidada atual' }],
          users: [{ id: 'user', full_name: 'Ana', email: 'ana@example.com' }],
        },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThreadInvitations threadId="thread" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Convidar para a conversa' }));
  const user = await screen.findByLabelText('Usuário convidado');
  fireEvent.change(user, { target: { value: 'user' } });
  fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/threads/thread/invitations', {
      method: 'POST',
      body: { user_id: 'user' },
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Encerrar convite' })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Encerrar convite' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/threads/thread/invitations/invitation', {
      method: 'DELETE',
    }),
  );
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/members'), expect.anything());
});
