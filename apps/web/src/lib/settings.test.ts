import { describe, expect, it, vi } from 'vitest';
import type { TenantRole } from '@apmail/shared';
import { requireCompany, type Me } from './auth';
import { requireSettingsCapability } from './settings';

vi.mock('./auth', () => ({ requireCompany: vi.fn() }));

function session(role: TenantRole, permissions: string[] | null, capabilities: string[] = []): Me {
  return {
    user: { id: 'user', email: 'user@example.com', full_name: 'Usuário', avatar_url: null },
    tenants: [
      {
        id: 'tenant',
        name: 'Empresa',
        slug: 'empresa',
        role,
        capabilities,
        access_profile_id: null,
        access_permissions: permissions,
      },
    ],
    platform_admin: false,
    support: null,
    current_tenant_id: 'tenant',
    preferences: {
      theme: 'light',
      density: 'compact',
      timezone: 'America/Sao_Paulo',
      notify_mentions: false,
      notify_assignments: false,
      notify_chat: false,
      desktop_notifications: false,
      load_remote_images: false,
    },
  };
}

describe('requireSettingsCapability', () => {
  it('respeita concessões pessoais de um membro sem perfil personalizado', async () => {
    const me = session('member', ['users.view', 'audit.view']);
    vi.mocked(requireCompany).mockResolvedValue(me);
    await expect(requireSettingsCapability('members')).resolves.toBe(me);
    await expect(requireSettingsCapability('audit')).resolves.toBe(me);
  });

  it('respeita revogações pessoais mesmo quando o papel legado tem capacidades delegadas', async () => {
    vi.mocked(requireCompany).mockResolvedValue(session('supervisor', [], ['members', 'audit']));
    await expect(requireSettingsCapability('members')).rejects.toMatchObject({ status: 403 });
    await expect(requireSettingsCapability('audit')).rejects.toMatchObject({ status: 403 });
  });

  it('preserva as capacidades de papéis legados que continuam sem exceções pessoais', async () => {
    const me = session('supervisor', null, ['members']);
    vi.mocked(requireCompany).mockResolvedValue(me);
    await expect(requireSettingsCapability('members')).resolves.toBe(me);
    await expect(requireSettingsCapability('audit')).rejects.toMatchObject({ status: 403 });
  });
});
