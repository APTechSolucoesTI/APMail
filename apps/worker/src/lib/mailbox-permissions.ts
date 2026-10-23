import { sql } from 'kysely';
import {
  can,
  canDelegate,
  isTenantAdmin,
  profileAllowsMailbox,
  type MailboxPerm,
} from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from '../imap/connect.js';
export async function userCanMailbox(
  r: WorkerResources,
  box: Mailbox,
  userId: string,
  perm: MailboxPerm,
) {
  if (perm === 'send' && box.receiving_protocol === 'local') return false;
  const access = await r.db
    .selectFrom('tenant_members as tm')
    .leftJoin('mailbox_members as mm', (j) =>
      j
        .onRef('mm.tenant_id', '=', 'tm.tenant_id')
        .onRef('mm.user_id', '=', 'tm.user_id')
        .on('mm.mailbox_id', '=', box.id),
    )
    .innerJoin('tenants as tenant', 'tenant.id', 'tm.tenant_id')
    .leftJoin('access_profiles as p', (j) =>
      j.onRef('p.id', '=', 'tm.access_profile_id').onRef('p.tenant_id', '=', 'tm.tenant_id'),
    )
    .select([
      'tm.role',
      'tm.capabilities',
      'mm.role as mailbox_role',
      'tm.access_profile_id',
      'tm.custom_permissions',
      sql<string[] | null>`coalesce(tm.custom_permissions,p.permissions)`.as('permissions'),
    ])
    .where('tm.tenant_id', '=', box.tenant_id)
    .where('tm.user_id', '=', userId)
    .where('tm.status', '=', 'active')
    .where('tenant.suspended_at', 'is', null)
    .where('tenant.deleted_at', 'is', null)
    .executeTakeFirst();
  if (
    access &&
    (access.access_profile_id || access.custom_permissions !== null) &&
    !profileAllowsMailbox({ role: access.role, access_permissions: access.permissions ?? [] }, perm)
  )
    return false;
  return (
    !!access &&
    (isTenantAdmin(access.role) ||
      can(access.mailbox_role, perm) ||
      (!!access.mailbox_role && canDelegate(access.role, access.capabilities, perm)))
  );
}
