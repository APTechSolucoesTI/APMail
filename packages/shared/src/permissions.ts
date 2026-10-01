export const MAILBOX_PERMS = [
  'read',
  'send',
  'note',
  'queue',
  'assign_self',
  'assign_others',
  'organize',
  'rules',
  'cancel_any',
  'dashboard',
] as const;
export type MailboxPerm = (typeof MAILBOX_PERMS)[number];
export type MailboxRole = 'mailbox_admin' | 'editor' | 'viewer';
export type TenantRole = 'owner' | 'admin' | 'member';
export const ROLE_PERMS: Record<MailboxRole, readonly MailboxPerm[]> = {
  viewer: ['read'],
  editor: ['read', 'send', 'note', 'queue', 'assign_self'],
  mailbox_admin: MAILBOX_PERMS,
};
export const can = (role: MailboxRole | null, perm: MailboxPerm): boolean =>
  !!role && ROLE_PERMS[role].includes(perm);
