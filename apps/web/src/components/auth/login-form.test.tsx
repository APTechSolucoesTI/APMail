import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './login-form';
import { api } from '@/lib/api';
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('@/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
it('mantém o login na segunda etapa sem navegar até a confirmação do autenticador', async () => {
  const user = userEvent.setup();
  vi.mocked(api)
    .mockResolvedValueOnce({ requires_two_factor: true, challenge: 'qa-challenge' })
    .mockResolvedValueOnce({ user: { id: 'qa' } });
  render(<LoginForm />);
  await user.type(screen.getByLabelText('E-mail', { exact: true }), 'user@qa.example');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'QaPassword123!');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByText('Verificação em duas etapas')).toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Senha', { exact: true })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Código do aplicativo', { exact: true }), '123456');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith('/auth/two-factor/login', {
      method: 'POST',
      body: { challenge: 'qa-challenge', code: '123456' },
    }),
  );
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
});
