import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AccessProfiles } from './access-profiles';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('@/lib/auth', () => ({
  useTenantId: () => 'tenant',
  useAccess: () => true,
  meQuery: {
    queryKey: ['me'],
    queryFn: async () => ({
      current_tenant_id: 'tenant',
      tenants: [{ id: 'tenant', role: 'owner' }],
    }),
  },
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
it('oferece perfil de cadastro e seleciona o acesso à tela ao habilitar uma ação', async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockImplementation(async (_path, options) =>
    options?.method ? { id: 'new' } : [],
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccessProfiles />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Criar perfil' });
  await user.click(screen.getByRole('button', { name: 'Criar perfil' }));
  await user.type(screen.getByLabelText('Nome do perfil'), 'Atendimento');
  await user.click(screen.getByRole('checkbox', { name: /Enviar e responder/ }));
  expect(screen.getByRole('checkbox', { name: 'E-mail' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/access-profiles', {
      method: 'POST',
      body: { name: 'Atendimento', description: '', permissions: ['mail.send', 'mail'] },
    }),
  );
});
