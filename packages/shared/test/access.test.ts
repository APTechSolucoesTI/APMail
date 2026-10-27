import { expect, it } from 'vitest';
import {
  hasAccess,
  profileMissingDependencies,
  screenPermission,
  accessProfileSchema,
  profileAllowsMailbox,
} from '../src/access.js';
it('preserva administradores e nega módulos não concedidos ao perfil personalizado', () => {
  expect(hasAccess({ role: 'admin' }, 'audit.view')).toBe(true);
  expect(hasAccess({ role: 'member' }, 'mail')).toBe(true);
  const creator = { role: 'member' as const, access_permissions: ['users.view', 'users.invite'] };
  expect(hasAccess(creator, 'users.invite')).toBe(true);
  for (const permission of ['users.manage', 'profiles.manage', 'mail', 'audit.content'] as const)
    expect(hasAccess(creator, permission)).toBe(false);
  expect(hasAccess({ role: 'member', access_permissions: [] }, 'mail')).toBe(false);
});
it('valida permissões conhecidas, remove repetições e exige a tela relacionada à ação', () => {
  expect(
    accessProfileSchema.safeParse({ name: 'Teste', permissions: ['superadmin'] }).success,
  ).toBe(false);
  expect(
    accessProfileSchema.parse({ name: 'Teste', permissions: ['mail', 'mail'] }).permissions,
  ).toEqual(['mail']);
  expect(profileMissingDependencies(['users.invite', 'audit.content'])).toEqual([
    'users.view',
    'audit.view',
  ]);
  expect(profileMissingDependencies(['users.invite', 'users.view'])).toEqual([]);
  expect(profileMissingDependencies(['profiles.manage'])).toEqual(['users.view']);
});
it('protege links diretos e combina o perfil com as permissões de caixa', () => {
  expect(screenPermission('/settings/access-profiles')).toBe('profiles.manage');
  expect(screenPermission('/settings/audit')).toBe('audit.view');
  expect(screenPermission('/mail-summary')).toBe('mail');
  expect(screenPermission('/settings/preferences')).toBeNull();
  expect(profileAllowsMailbox({ role: 'member', access_permissions: ['mail'] }, 'send')).toBe(
    false,
  );
  expect(profileAllowsMailbox({ role: 'member', access_permissions: ['mail'] }, 'read')).toBe(true);
});
