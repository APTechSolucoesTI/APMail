import { sql } from 'kysely';
import type { MailboxQuota } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';

export async function quotaResumeState(r: WorkerResources, tenant: string, box: string) {
  return (
    await sql<{
      checkpoint: MailboxQuota['sync_checkpoint'];
      tenant_used: string;
      mailbox_used: string;
      tenant_limit: string | null;
      mailbox_limit: string | null;
      provider_checked_at: Date | null;
    }>`
    select l.sync_checkpoint as checkpoint,storage_quota_usage(l.tenant_id)::text as tenant_used,
    storage_quota_usage(l.tenant_id,l.mailbox_id)::text as mailbox_used,t.storage_limit_bytes::text as tenant_limit,l.allocated_bytes::text as mailbox_limit,l.provider_checked_at
    from mailbox_storage_limits l left join tenant_storage_limits t on t.tenant_id=l.tenant_id where l.tenant_id=${tenant}::uuid and l.mailbox_id=${box}::uuid`.execute(
      r.db,
    )
  ).rows[0];
}
export function canResumeQuota(state: NonNullable<Awaited<ReturnType<typeof quotaResumeState>>>) {
  const c = state.checkpoint;
  return (
    !c ||
    state.tenant_limit !== c.tenant_limit ||
    state.mailbox_limit !== c.mailbox_limit ||
    BigInt(state.tenant_used) < BigInt(c.tenant_used) ||
    BigInt(state.mailbox_used) < BigInt(c.mailbox_used)
  );
}
export async function saveQuotaCheckpoint(
  r: WorkerResources,
  tenant: string,
  box: string,
  folder: string,
  validity: string,
  lastUid: number,
  nextUid: number,
  error: unknown,
) {
  const state = await quotaResumeState(r, tenant, box);
  if (!state) throw Error('Mailbox quota configuration missing');
  const checkpoint = {
    folder_id: folder,
    uidvalidity: validity,
    last_uid: lastUid,
    next_uid: nextUid,
    reason: (error as Error).message,
    tenant_used: state.tenant_used,
    mailbox_used: state.mailbox_used,
    tenant_limit: state.tenant_limit,
    mailbox_limit: state.mailbox_limit,
  };
  await r.db.transaction().execute(async (tx) => {
    await tx
      .updateTable('folders')
      .set({ last_uid: lastUid })
      .where('id', '=', folder)
      .where('mailbox_id', '=', box)
      .execute();
    await sql`update mailbox_storage_limits set sync_checkpoint=${JSON.stringify(checkpoint)}::jsonb,paused_at=now() where mailbox_id=${box}::uuid and tenant_id=${tenant}::uuid`.execute(
      tx,
    );
  });
  r.io.to(`mailbox:${box}`).emit('mailbox:storage', { mailbox_id: box, paused: true });
}
