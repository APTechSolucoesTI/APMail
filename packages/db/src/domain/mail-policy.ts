import { randomUUID } from 'node:crypto';
import { queuesEnabled } from '@apmail/shared';
import type { Database } from './threads.js';
export async function tenantQueuesEnabled(db: Database, tenantId: string): Promise<boolean> {
  const tenant = await db
    .selectFrom('tenants')
    .select('settings')
    .where('id', '=', tenantId)
    .executeTakeFirst();
  return queuesEnabled(tenant?.settings);
}
export async function requestTenantQueueRefresh(db: Database, tenantId: string): Promise<string> {
  const generation = randomUUID();
  await db
    .insertInto('tenant_mail_policy_runs')
    .values({ tenant_id: tenantId, generation, state: 'queued' })
    .onConflict((oc) =>
      oc
        .column('tenant_id')
        .doUpdateSet({
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
