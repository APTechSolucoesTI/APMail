import { randomUUID } from 'node:crypto';
import type { Database } from './threads.js';
/** @deprecated Service status is always available; use mailboxQueuesEnabled for queue presentation. */
export async function tenantQueuesEnabled(db: Database, tenantId: string): Promise<boolean> {
  const tenant = await db
    .selectFrom('tenants')
    .select('id')
    .where('id', '=', tenantId)
    .executeTakeFirst();
  return !!tenant;
}
/** A presentation preference only; never use to authorize service operations. */
export async function mailboxQueuesEnabled(
  db: Database,
  tenantId: string,
  mailboxId: string,
): Promise<boolean> {
  const box = await db
    .selectFrom('mailboxes')
    .select('queues_enabled')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', mailboxId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return box?.queues_enabled ?? false;
}
export async function requestTenantQueueRefresh(db: Database, tenantId: string): Promise<string> {
  const generation = randomUUID();
  await db
    .insertInto('tenant_mail_policy_runs')
    .values({ tenant_id: tenantId, generation, state: 'queued' })
    .onConflict((oc) =>
      oc.column('tenant_id').doUpdateSet({
        generation,
        state: 'queued',
        after_thread_id: null,
        processed: 0,
        started_at: null,
        finished_at: null,
        error: null,
        updated_at: new Date(),
      }),
    )
    .execute();
  return generation;
}
