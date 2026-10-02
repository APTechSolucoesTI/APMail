import { isTenantAdmin } from '@apmail/shared';
import { sql } from 'kysely';
import type { Database } from './threads.js';
/** Revalidates the destination of queued folder actions against current membership. */
export async function userCanReadFolder(
  db: Database,
  tenantId: string,
  boxId: string,
  userId: string,
  folderId: string,
) {
  const member = await db
    .selectFrom('tenant_members as tm')
    .innerJoin('tenants as t', 't.id', 'tm.tenant_id')
    .leftJoin('mailbox_members as mm', (j) =>
      j
        .onRef('mm.tenant_id', '=', 'tm.tenant_id')
        .onRef('mm.user_id', '=', 'tm.user_id')
        .on('mm.mailbox_id', '=', boxId),
    )
    .select(['tm.role', 'mm.role as mailbox_role', 'mm.restrict_to_folders'])
    .where('tm.tenant_id', '=', tenantId)
    .where('tm.user_id', '=', userId)
    .where('tm.status', '=', 'active')
    .where('t.deleted_at', 'is', null)
    .where('t.suspended_at', 'is', null)
    .executeTakeFirst();
  if (!member) return false;
  if (isTenantAdmin(member.role) || member.mailbox_role === 'mailbox_admin') return true;
  if (!member.mailbox_role) return false;
  if (!member.restrict_to_folders) return true;
  const result = await sql<{ allowed: boolean }>`with recursive allowed as (
    select f.id from folders f join folder_permissions p on p.folder_id=f.id and p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id
    where p.tenant_id=${tenantId} and p.mailbox_id=${boxId} and p.user_id=${userId} and f.deleted_at is null
    union select f.id from folders f join allowed a on f.parent_id=a.id where f.tenant_id=${tenantId} and f.mailbox_id=${boxId} and f.deleted_at is null
  ) select exists(select 1 from allowed where id=${folderId}::uuid) as allowed`.execute(db);
  return result.rows[0]?.allowed ?? false;
}
/** Permissão atual, incluindo subpastas, para worker e notificações. */
export async function userCanReadThread(
  db: Database,
  tenantId: string,
  boxId: string,
  userId: string,
  threadId: string,
  messageId?: string,
) {
  const member = await db
    .selectFrom('tenant_members')
    .innerJoin('tenants', 'tenants.id', 'tenant_members.tenant_id')
    .select('tenant_members.role')
    .where('tenant_members.tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .where('tenants.suspended_at', 'is', null)
    .where('tenants.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!member) return false;
  if (isTenantAdmin(member.role)) return true;
  const access = await db
    .selectFrom('mailbox_members')
    .select(['role', 'restrict_to_folders'])
    .where('tenant_id', '=', tenantId)
    .where('mailbox_id', '=', boxId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!access) return false;
  if (access.role === 'mailbox_admin' || !access.restrict_to_folders) return true;
  const result = await sql<{ allowed: boolean }>`with recursive allowed as (
  select f.id from folders f join folder_permissions p on p.folder_id=f.id and p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id where p.tenant_id=${tenantId} and p.mailbox_id=${boxId} and p.user_id=${userId} and f.deleted_at is null
  union select f.id from folders f join allowed a on f.parent_id=a.id where f.tenant_id=${tenantId} and f.mailbox_id=${boxId} and f.deleted_at is null
 ) select exists(select 1 from messages m join allowed a on a.id=m.folder_id where m.tenant_id=${tenantId} and m.mailbox_id=${boxId} and m.thread_id=${threadId} and m.deleted_at is null ${messageId ? sql`and m.id=${messageId}` : sql``}) as allowed`.execute(
    db,
  );
  return result.rows[0]?.allowed ?? false;
}
