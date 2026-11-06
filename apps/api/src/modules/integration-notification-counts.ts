import { sql } from 'kysely';
import { activeInvitationPredicate, operatorThreadPredicate } from '@apmail/db';
import { unreadInbound } from './mail-visibility-queries.js';
import type { Resources } from './resources.js';

/** Counts existing per-user read state without marking, syncing or loading message contents. */
export async function integrationNotificationCounts(
  db: Resources['db'],
  tenantId: string,
  userId: string,
) {
  const result = await sql<{ unread: number; pending: number }>`
    with recursive boxes as (
      select b.id,mm.role,(mm.role in ('mailbox_admin','supervisor') or not mm.restrict_to_folders) full_access
      from mailboxes b join mailbox_members mm on mm.mailbox_id=b.id and mm.tenant_id=b.tenant_id
      where b.tenant_id=${tenantId} and b.deleted_at is null and mm.user_id=${userId}
    ), allowed_folders as (
      select f.id,f.mailbox_id from folders f join boxes b on b.id=f.mailbox_id
      where f.tenant_id=${tenantId} and f.deleted_at is null and
        (b.full_access or exists(select 1 from folder_permissions p
          where p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id and p.folder_id=f.id and p.user_id=${userId}))
      union
      select f.id,f.mailbox_id from folders f join allowed_folders a on a.id=f.parent_id and a.mailbox_id=f.mailbox_id
      where f.tenant_id=${tenantId} and f.deleted_at is null
    ), invitations as (
      select si.thread_id from thread_service_invitations si
      where si.tenant_id=${tenantId} and si.invitee_id=${userId} and si.state='active'
        and ${activeInvitationPredicate(tenantId, userId, sql`si.thread_id`)}
    ), visible as (
      select m.id,m.thread_id,m.message_at,m.direction,m.is_automated,m.is_mdn,m.source_kind,m.mdn_provider_seen,
        t.queue_status,t.queue_excluded,t.manual_done_at,us.last_read_at
      from threads t join mailboxes box on box.id=t.mailbox_id and box.tenant_id=t.tenant_id and box.deleted_at is null
      join messages m on m.thread_id=t.id and m.tenant_id=t.tenant_id and m.mailbox_id=t.mailbox_id
      join folders f on f.id=m.folder_id and f.mailbox_id=m.mailbox_id and f.tenant_id=m.tenant_id and f.deleted_at is null
      left join thread_user_state us on us.thread_id=t.id and us.tenant_id=t.tenant_id and us.user_id=${userId}
      where t.tenant_id=${tenantId} and t.deleted_at is null and m.deleted_at is null
        and coalesce(f.special_use::text,'') not in ('trash','junk')
        and (
          (exists(select 1 from allowed_folders af where af.id=m.folder_id and af.mailbox_id=m.mailbox_id)
            and ${operatorThreadPredicate(tenantId, userId, sql`t.id`, sql`t.mailbox_id`, false)})
          or exists(select 1 from invitations i where i.thread_id=t.id)
        )
    )
    select count(*) filter(where ${unreadInbound} and m.message_at>coalesce(m.last_read_at,'-infinity'::timestamptz))::int unread,
      count(distinct m.thread_id) filter(where m.queue_status in ('to_reply','in_progress')
        and m.manual_done_at is null and not m.queue_excluded)::int pending
    from visible m
  `.execute(db);
  return result.rows[0]!;
}
