import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AccessEditor } from './access-editor';
import { api } from '@/lib/api';
import { TenantContext } from '@/lib/auth';

vi.mock('@/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock('./folder-access-picker', () => ({ FolderAccessPicker: () => null }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const supervisor = {
  id: 'supervisor-profile',
  name: 'Supervisor',
  description: '',
  system_role: 'supervisor',
  permissions: ['mail'],
  member_count: 0,
  invitation_count: 0,
};
const custom = { ...supervisor, id: 'custom-profile', name: 'Atendimento', system_role: null };
const admin = { ...supervisor, id: 'admin-profile', name: 'Administrador', system_role: 'admin' };
const owner = { ...supervisor, id: 'owner-profile', name: 'Proprietário', system_role: 'owner' };
const member = { ...supervisor, id: 'member-profile', name: 'Membro', system_role: 'member' };
const box = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Equipe',
  email_address: 'equipe@example.com',
  status: 'active',
};
function setup(customPermissions: string[] | null = null, userId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['me'], {
    user: { id: 'actor' },
    current_tenant_id: 'tenant',
    tenants: [
      {
        id: 'tenant',
        role: 'owner',
        access_permissions: customPermissions,
        access_profile_id: null,
      },
    ],
  });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/access-profiles') return [supervisor, custom, admin, owner, member] as never;
    if (path === '/mailboxes') return [box] as never;
    if (path === '/tenant') return { settings: { default_invitation_mailbox_id: box.id } } as never;
    if (path === '/members/user/access')
      return { tenant_role: 'member', access_profile_id: null, mailbox_roles: [] } as never;
    if (path === '/auth/me') return client.getQueryData(['me']) as never;
    return {} as never;
  });
  render(
    <QueryClientProvider client={client}>
      <TenantContext value="tenant">
        <AccessEditor userId={userId} onDone={() => undefined} />
      </TenantContext>
    </QueryClientProvider>,
  );
}

describe('AccessEditor', () => {
  it('usa os perfis persistidos e não oferece proprietário ao convidar', async () => {
    setup();
    const select = await screen.findByLabelText('Perfil de acesso');
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      'Selecione um perfil',
      'Supervisor',
      'Atendimento',
      'Administrador',
      'Membro',
    ]);
    fireEvent.change(select, { target: { value: 'profile:supervisor-profile' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/invitations',
        expect.objectContaining({
          body: expect.objectContaining({ tenant_role: 'supervisor', access_profile_id: null }),
        }),
      ),
    );
  });

  it('mantém perfil personalizado como membro e envia seu ID', async () => {
    setup(null, 'user');
    fireEvent.change(await screen.findByLabelText('Perfil de acesso'), {
      target: { value: 'profile:custom-profile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar permissões' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/members/user/access',
        expect.objectContaining({
          body: expect.objectContaining({
            tenant_role: 'member',
            access_profile_id: 'custom-profile',
          }),
        }),
      ),
    );
  });

  it('reconhece exceções pessoais sem ID de perfil e limita as opções ao acesso efetivo', async () => {
    setup(['mail', 'users.invite']);
    await screen.findByLabelText('Perfil de acesso');
    expect(screen.queryByLabelText('Enviar convite pela caixa')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Administrador' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Proprietário' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Membro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Supervisor' })).not.toBeInTheDocument();
  });
});
