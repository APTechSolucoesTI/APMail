import { sql, type Kysely } from 'kysely';
import type { DB } from './types.js';

export const quotaErrors: Record<string, string> = {
  tenant_storage_quota_exceeded:
    'A empresa atingiu o limite de armazenamento do APMail. Solicite a ampliação ao superadmin.',
  mailbox_storage_quota_exceeded:
    'Esta caixa atingiu a cota do APMail. Redistribua o armazenamento na página Empresa ou solicite uma ampliação.',
  mailbox_count_limit_exceeded:
    'A empresa atingiu o número máximo de caixas. Solicite a ampliação ao superadmin.',
  mailbox_allocation_required:
    'Não há armazenamento disponível para uma nova caixa. Redistribua as cotas na página Empresa antes de continuar.',
};
export function isStorageQuotaError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['tenant_storage_quota_exceeded', 'mailbox_storage_quota_exceeded'].includes(error.message)
  );
}
export async function assertStorageGrowth(
  db: Kysely<DB>,
  tenant: string,
  box: string | null,
  bytes: bigint,
) {
  await sql`select storage_quota_assert(${tenant}::uuid,${box}::uuid,${bytes.toString()}::bigint)`.execute(
    db,
  );
}
export async function lockStorageTenant(db: Kysely<DB>, tenant: string) {
  await db
    .selectFrom('tenants')
    .select('id')
    .where('id', '=', tenant)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
export async function assertStorageCapacity(db: Kysely<DB>, tenant: string, box: string) {
  await sql`select storage_quota_assert_current(${tenant}::uuid,${box}::uuid)`.execute(db);
}
/** Friendly preflight; the database trigger remains authoritative under concurrent creation. */
export async function assertMailboxSlot(db: Kysely<DB>, tenant: string) {
  const row = (
    await sql<{
      max: number | null;
      count: number;
      mode: string;
      cap: string | null;
      allocated: string;
    }>`select l.max_mailboxes as max,l.allocation_mode as mode,l.storage_limit_bytes::text as cap,
    (select count(*)::integer from mailboxes b where b.tenant_id=t.id and b.deleted_at is null) as count,
    (select coalesce(sum(m.allocated_bytes),0)::text from mailbox_storage_limits m join mailboxes b on b.id=m.mailbox_id where b.tenant_id=t.id and b.deleted_at is null) as allocated
    from tenants t left join tenant_storage_limits l on l.tenant_id=t.id where t.id=${tenant}::uuid`.execute(
      db,
    )
  ).rows[0];
  if (row?.max !== null && row?.max !== undefined && row.count >= row.max)
    throw Error('mailbox_count_limit_exceeded');
  if (row?.mode === 'manual' && row.cap !== null && BigInt(row.allocated) >= BigInt(row.cap))
    throw Error('mailbox_allocation_required');
}
