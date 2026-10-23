import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { UserPermissions } from './user-permissions';
import { api } from '@/lib/api';
import { TenantContext } from '@/lib/auth';

vi.mock('@/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock('./team-navigation', () => ({ TeamNavigation: () => null }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
function setup(customized = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], {
    user: { id: 'actor' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'owner', access_permissions: null }],
  });
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/auth/me') return client.getQueryData(['me']) as never;
    if (path === '/members')
      return {
        members: [
          {
            user_id: 'member',
            full_name: 'Ana',
            email: 'ana@example.com',
            role: 'member',
            status: 'active',
          },
          {
            user_id: 'owner',
            full_name: 'Gabriel',
            email: 'gabriel@example.com',
            role: 'owner',
            status: 'active',
          },
        ],
      } as never;
    if (path === '/members/member/permissions') {
      if (options?.method === 'PUT') return {} as never;
      return {
        access_profile_id: 'profile',
        profile_name: 'Consulta de contatos',
        base_permissions: ['contacts'],
        permissions: customized ? ['contacts', 'contacts.delete'] : ['contacts'],
        customized,
      } as never;
    }
    return {} as never;
  });
  render(
    <QueryClientProvider client={client}>
      <TenantContext value="tenant">
        <UserPermissions />
      </TenantContext>
    </QueryClientProvider>,
  );
}

describe('UserPermissions', () => {
  it('copia o acesso herdado e salva uma exceção completa somente para o usuário selecionado', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('Usuário'), { target: { value: 'member' } });
    expect(await screen.findByRole('checkbox', { name: 'Contatos' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Excluir contatos' })).not.toBeChecked();
    expect(screen.getByText('Consulta de contatos')).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Excluir contatos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar permissões do usuário' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/members/member/permissions', {
        method: 'PUT',
        body: { permissions: ['contacts', 'contacts.delete'] },
      }),
    );
  });

  it('restaura a herança do perfil após confirmação', async () => {
    setup(true);
    fireEvent.change(await screen.findByLabelText('Usuário'), { target: { value: 'member' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar permissões do perfil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/members/member/permissions', {
        method: 'PUT',
        body: { permissions: null },
      }),
    );
  });

  it('preserva o acesso administrativo dos perfis protegidos', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('Usuário'), { target: { value: 'owner' } });
    expect(await screen.findByText('Perfil protegido pelo sistema')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Salvar permissões do usuário' }),
    ).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      '/members/owner/permissions',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
