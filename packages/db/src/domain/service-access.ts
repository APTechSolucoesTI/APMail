import { sql, type RawBuilder } from 'kysely';
import type { Database } from './threads.js';
import { profileAllowsMailbox, type MailboxPerm } from '@apmail/shared';

export function activeInvitationPredicate(
  tenantId: string,
  userId: string,
  threadId: RawBuilder<unknown>,
) {
  return sql<boolean>`exists(select 1 from thread_service_invitations si
    join threads invited on invited.id=si.thread_id and invited.tenant_id=si.tenant_id
    join tenant_members member on member.tenant_id=si.tenant_id and member.user_id=si.invitee_id
    join tenants company on company.id=si.tenant_id
    where si.tenant_id=${tenantId} and si.invitee_id=${userId} and si.thread_id=${threadId}
      and si.state='active' and member.status='active' and invited.manual_done_at is null and invited.queue_status<>'done'
      and invited.deleted_at is null and company.deleted_at is null and company.suspended_at is null)`;
}
/** Additional operational boundary; mailbox/folder/profile access must still be checked. */
export function operatorThreadPredicate(
  tenantId: string,
  userId: string,
  threadId: RawBuilder<unknown>,
  mailboxId: RawBuilder<unknown>,
  includeInvitations = true,
) {
  return sql<boolean>`(not exists(select 1 from mailbox_members operator join tenants company on company.id=operator.tenant_id
    where operator.tenant_id=${tenantId} and operator.user_id=${userId} and operator.mailbox_id=${mailboxId}
      and operator.role='editor' and coalesce((company.settings->>'restrict_operators_to_assigned')::boolean,false))
    or exists(select 1 from threads owned where owned.tenant_id=${tenantId} and owned.id=${threadId} and owned.assigned_to=${userId})
    or ${includeInvitations ? activeInvitationPredicate(tenantId, userId, threadId) : sql<boolean>`false`})`;
}
export async function hasConversationInvitation(
  db: Database,
  tenantId: string,
  userId: string,
  threadId: string,
) {
  const result = await sql<{
    allowed: boolean;
  }>`select ${activeInvitationPredicate(tenantId, userId, sql`${threadId}::uuid`)} as allowed`.execute(
    db,
  );
  return result.rows[0]?.allowed ?? false;
}
export async function invitationAllowsPermission(
  db: Database,
  tenantId: string,
  userId: string,
  threadId: string,
  permission: MailboxPerm,
) {
  if (
    !['read', 'send', 'note', 'queue'].includes(permission) ||
    !(await hasConversationInvitation(db, tenantId, userId, threadId))
  )
    return false;
  const member = await db
    .selectFrom('tenant_members as tm')
    .leftJoin('access_profiles as p', (j) =>
      j.onRef('p.id', '=', 'tm.access_profile_id').onRef('p.tenant_id', '=', 'tm.tenant_id'),
    )
    .select([
      'tm.role',
      sql<string[] | null>`coalesce(tm.custom_permissions,p.permissions)`.as('permissions'),
    ])
    .where('tm.tenant_id', '=', tenantId)
    .where('tm.user_id', '=', userId)
    .where('tm.status', '=', 'active')
    .executeTakeFirst();
  return (
    !!member &&
    profileAllowsMailbox({ role: member.role, access_permissions: member.permissions }, permission)
  );
}
