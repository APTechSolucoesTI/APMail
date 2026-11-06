import { sql } from 'kysely';
import { can, hasAccess } from '@apmail/shared';
import type { Database } from './threads.js';
import { recomputeThreadStatus } from './threads.js';

/** Reuses existing access; configuring ownership must never grant it silently. */
export async function mailboxOwnerEligible(
  db: Database,
  tenantId: string,
  mailboxId: string,
  userId: string,
): Promise<boolean> {
  const member = await db
    .selectFrom('tenant_members as tm')
    .innerJoin('mailbox_members as mm', (j) =>
      j
        .onRef('mm.tenant_id', '=', 'tm.tenant_id')
        .onRef('mm.user_id', '=', 'tm.user_id')
        .on('mm.mailbox_id', '=', mailboxId),
    )
    .leftJoin('access_profiles as ap', (j) =>
      j.onRef('ap.id', '=', 'tm.access_profile_id').onRef('ap.tenant_id', '=', 'tm.tenant_id'),
    )
    .select([
      'tm.role',
      'tm.access_profile_id',
      'tm.custom_permissions',
      'mm.role as mailbox_role',
      sql<string[] | null>`coalesce(tm.custom_permissions,ap.permissions)`.as('permissions'),
    ])
    .where('tm.tenant_id', '=', tenantId)
    .where('tm.user_id', '=', userId)
    .where('tm.status', '=', 'active')
    .executeTakeFirst();
  if (!member || !can(member.mailbox_role, 'send')) return false;
  const access =
    member.access_profile_id || member.custom_permissions !== null
      ? (member.permissions ?? [])
      : null;
  return (
    hasAccess({ role: member.role, access_permissions: access }, 'mail') &&
    hasAccess({ role: member.role, access_permissions: access }, 'mail.send')
  );
}

/** Caller holds a transaction and has already checked thread visibility/send permission. */
export async function startThreadService(db: Database, threadId: string, actorId: string) {
  const thread = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', threadId)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const now = new Date();
  await db
    .updateTable('threads')
    .set({
      service_started_at: thread.manual_done_at ? now : (thread.service_started_at ?? now),
      assigned_to: thread.assigned_to ?? actorId,
      assigned_at: thread.assigned_to ? thread.assigned_at : now,
      manual_done_at: null,
      queue_excluded: false,
      history_queue_eligible: true,
    })
    .where('id', '=', threadId)
    .where('tenant_id', '=', thread.tenant_id)
    .execute();
  return recomputeThreadStatus(db, threadId, 'manual', actorId);
}

/** Only call for a newly persisted live inbound message, never a history/import refresh. */
export async function assignIndividualMailboxOwnerOnInbound(db: Database, threadId: string) {
  const thread = await db
    .selectFrom('threads as t')
    .innerJoin('mailboxes as b', (j) =>
      j.onRef('b.id', '=', 't.mailbox_id').onRef('b.tenant_id', '=', 't.tenant_id'),
    )
    .select(['t.tenant_id', 't.mailbox_id', 't.assigned_to', 'b.box_type', 'b.owner_user_id'])
    .where('t.id', '=', threadId)
    .where('b.deleted_at', 'is', null)
    .forUpdate('t')
    .executeTakeFirst();
  if (!thread || thread.box_type !== 'individual' || !thread.owner_user_id || thread.assigned_to)
    return false;
  if (!(await mailboxOwnerEligible(db, thread.tenant_id, thread.mailbox_id, thread.owner_user_id)))
    return false;
  await db
    .updateTable('threads')
    .set({ assigned_to: thread.owner_user_id, assigned_at: new Date() })
    .where('id', '=', threadId)
    .where('tenant_id', '=', thread.tenant_id)
    .execute();
  return true;
}
