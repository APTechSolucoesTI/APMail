import { expect, it } from 'vitest';
import {
  accessProfileSchema,
  profileMissingDependencies,
  profileAllowsMailbox,
  legacyAccessPermissions,
} from './access.js';
it('keeps move, delete, restore and flag permissions independent', () => {
  const permissions = ['mail', 'mail.organize', 'mail.move'];
  expect(accessProfileSchema.safeParse({ name: 'Mover apenas', permissions }).success).toBe(true);
  expect(profileMissingDependencies(permissions)).toEqual([]);
  expect(profileAllowsMailbox({ role: 'member', access_permissions: permissions }, 'move')).toBe(
    true,
  );
  expect(profileAllowsMailbox({ role: 'member', access_permissions: permissions }, 'delete')).toBe(
    false,
  );
});
it('requires contact consultation for mutations, without granting other mutations', () => {
  expect(profileMissingDependencies(['contacts.create'])).toContain('contacts');
  expect(profileMissingDependencies(['contacts', 'contacts.create'])).toEqual([]);
});
it('derives standard permissions from roles and supervisor capabilities', () => {
  expect(legacyAccessPermissions('owner')).toContain('profiles.manage');
  expect(legacyAccessPermissions('member')).not.toContain('users.manage');
  expect(legacyAccessPermissions('member')).toContain('contacts.delete');
  expect(legacyAccessPermissions('supervisor', ['audit'])).toContain('audit.view');
  expect(legacyAccessPermissions('supervisor', [])).not.toContain('audit.view');
});
