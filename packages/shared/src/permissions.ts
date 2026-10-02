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
export type TenantRole = 'owner' | 'admin' | 'member' | 'supervisor';
export const isTenantAdmin = (role: string | null | undefined): boolean =>
  role === 'owner' || role === 'admin';
export const SUPERVISOR_CAPABILITIES = [
  'rules',
  'assign_others',
  'dashboard',
  'audit',
  'members',
  'contacts_visibility',
] as const;
export type SupervisorCapability = (typeof SUPERVISOR_CAPABILITIES)[number];
export const CAPABILITY_LABELS: Record<SupervisorCapability, string> = {
  rules: 'Gerenciar regras da caixa',
  assign_others: 'Atribuir a outros',
  dashboard: 'Ver dashboard',
  audit: 'Ver auditoria',
  members: 'Ver equipe',
  contacts_visibility: 'Gerenciar exibição de contatos',
};
export const canDelegate = (
  role: TenantRole | null,
  capabilities: readonly string[] | undefined,
  permission: string,
): boolean => role === 'supervisor' && !!capabilities?.includes(permission);
export const ROLE_PERMS: Record<MailboxRole, readonly MailboxPerm[]> = {
  viewer: ['read'],
  editor: ['read', 'send', 'note', 'queue', 'assign_self'],
  mailbox_admin: MAILBOX_PERMS,
};
export const can = (role: MailboxRole | null, perm: MailboxPerm): boolean =>
  !!role && ROLE_PERMS[role].includes(perm);
