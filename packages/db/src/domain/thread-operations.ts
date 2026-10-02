import { isTenantAdmin } from '@apmail/shared';
import { sql } from 'kysely';
import { can, type MailboxPerm, type QueueReason } from '@apmail/shared';
import type { Database } from './threads.js';
import { recomputeThreadStatus } from './threads.js';
import { audit } from './audit.js';
import { userCanReadThread } from './folder-access.js';
export async function mailboxUserCan(
  db: Database,
  tenantId: string,
  mailboxId: string,
  userId: string,
  perm: MailboxPerm,
): Promise<boolean> {
  const member = await db
    .selectFrom('tenant_members')
    .select('role')
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!member) return false;
  if (isTenantAdmin(member.role)) return true;
  const boxMember = await db
    .selectFrom('mailbox_members')
    .select('role')
    .where('tenant_id', '=', tenantId)
    .where('mailbox_id', '=', mailboxId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return can(boxMember?.role ?? null, perm);
}
export async function threadNotification(
  db: Database,
  value: {
    tenantId: string;
    mailboxId: string;
    threadId: string;
    actorId: string | null;
    userId: string;
    type: 'assignment' | 'mention';
    title: string;
    body: string;
  },
) {
  if (
    value.userId === value.actorId ||
    !(await userCanReadThread(db, value.tenantId, value.mailboxId, value.userId, value.threadId))
  )
    return null;
  const prefs = await db
    .selectFrom('user_preferences')
    .select(['notify_assignments', 'notify_mentions'])
    .where('user_id', '=', value.userId)
    .executeTakeFirst();
  if (
    value.type === 'assignment'
      ? prefs?.notify_assignments === false
      : prefs?.notify_mentions === false
  )
    return null;
  return db
    .insertInto('notifications')
    .values({
      tenant_id: value.tenantId,
      user_id: value.userId,
      type: value.type,
      title: value.title,
      body:
        value.type === 'assignment'
          ? 'Uma conversa foi atribuída a você.'
          : value.body.slice(0, 200),
      link: `/mail/${value.mailboxId}?thread=${value.threadId}`,
      payload: sql`${JSON.stringify({ thread_id: value.threadId, mailbox_id: value.mailboxId })}::jsonb`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
export async function assignThread(
  db: Database,
  threadId: string,
  userId: string | null,
  actorId: string | null,
  reason: QueueReason = 'assignment',
) {
  const thread = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', threadId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (thread.assigned_to === userId) return null;
  if (
    userId &&
    (!(await mailboxUserCan(db, thread.tenant_id, thread.mailbox_id, userId, 'send')) ||
      !(await userCanReadThread(db, thread.tenant_id, thread.mailbox_id, userId, threadId)))
  )
    throw new Error('invalid_assignee');
  await db
    .updateTable('threads')
    .set({ assigned_to: userId, assigned_at: userId ? new Date() : null })
    .where('id', '=', threadId)
    .execute();
  await audit(db, {
    tenantId: thread.tenant_id,
    actorId,
    action: 'thread.assigned',
    entityType: 'thread',
    entityId: threadId,
    metadata: { from_user_id: thread.assigned_to, to_user_id: userId, reason },
  });
  await recomputeThreadStatus(db, threadId, reason, actorId);
  return userId
    ? threadNotification(db, {
        tenantId: thread.tenant_id,
        mailboxId: thread.mailbox_id,
        threadId,
        actorId,
        userId,
        type: 'assignment',
        title: 'Conversa atribuída a você',
        body: thread.subject || '(sem assunto)',
      })
    : null;
}
