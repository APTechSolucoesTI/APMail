import { api } from './api';
import { queryClient } from './query-client';
import { redirect } from '@tanstack/react-router';
import {
  can,
  hasAccess,
  type AccessPermission,
  type MailboxRole,
  type TenantRole,
  type MailboxPerm,
} from '@apmail/shared';
import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
export const TenantContext = createContext<string | null>(null);
export const useTenantId = () => useContext(TenantContext);
export type Preferences = {
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
  timezone: string;
  notify_mentions: boolean;
  notify_assignments: boolean;
  notify_chat: boolean;
  desktop_notifications: boolean;
  load_remote_images: boolean;
  request_read_receipt?: boolean;
  mail_queues_enabled?: boolean;
};
export type Me = {
  user: { id: string; email: string; full_name: string; avatar_url: string | null };
  tenants: {
    id: string;
    name: string;
    slug: string;
    role: TenantRole;
    capabilities: string[];
    access_profile_id?: string | null;
    access_profile_name?: string | null;
    access_permissions?: string[] | null;
  }[];
  platform_admin: boolean;
  support: null;
  current_tenant_id: string | null;
  preferences: Preferences;
};
export type Mailbox = {
  receiving_protocol?: 'imap' | 'pop3' | 'local';
  id: string;
  name: string;
  email_address: string;
  status: 'pending' | 'active' | 'error' | 'disabled';
  last_error: string | null;
  last_synced_at: string | null;
  role: MailboxRole;
  permissions?: MailboxPerm[];
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  username?: string;
  aliases: string[];
  from_name_template: string;
  append_sent_copy: boolean;
};
export const canMailbox = (
  box: Pick<Mailbox, 'role' | 'permissions' | 'receiving_protocol'>,
  permission: MailboxPerm,
) =>
  (permission !== 'send' || box.receiving_protocol !== 'local') &&
  (box.permissions?.includes(permission) ?? can(box.role, permission));
export const meQuery = { queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false };
export const useMailQueues = () =>
  useQuery(meQuery).data?.preferences.mail_queues_enabled !== false;
export const useUserId = () => useQuery(meQuery).data?.user.id;
export const useAccess = (permission: AccessPermission) => {
  const me = useQuery(meQuery).data;
  return hasAccess(
    me?.tenants.find((t) => t.id === me.current_tenant_id),
    permission,
  );
};
export async function requireUser() {
  try {
    return await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 401)
      throw redirect({ to: '/login' });
    throw error;
  }
}
export async function requireCompany() {
  const me = await requireUser();
  if (me.platform_admin) throw redirect({ to: '/superadmin' });
  if (!me.current_tenant_id) throw redirect({ to: '/onboarding' });
  return me;
}
