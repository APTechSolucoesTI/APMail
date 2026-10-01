import { api } from './api';
import { queryClient } from './query-client';
import { redirect } from '@tanstack/react-router';
import type { MailboxRole, TenantRole } from '@apmail/shared';
export type Preferences = {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  timezone: string;
  notify_mentions: boolean;
  notify_assignments: boolean;
  notify_chat: boolean;
  desktop_notifications: boolean;
  load_remote_images: boolean;
};
export type Me = {
  user: { id: string; email: string; full_name: string; avatar_url: string | null };
  tenants: { id: string; name: string; slug: string; role: TenantRole }[];
  current_tenant_id: string | null;
  preferences: Preferences;
};
export type Mailbox = {
  id: string;
  name: string;
  email_address: string;
  status: 'pending' | 'active' | 'error' | 'disabled';
  last_error: string | null;
  last_synced_at: string | null;
  role: MailboxRole;
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
export const meQuery = { queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false };
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
  if (!me.current_tenant_id) throw redirect({ to: '/onboarding' });
  return me;
}
