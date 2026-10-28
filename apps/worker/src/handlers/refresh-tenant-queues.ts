import { touchThreads, tenantQueuesEnabled } from '@apmail/db';
import type { TenantQueueRefreshJob } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import { emitThreads } from '../lib/events.js';
export async function refreshTenantQueues(r: WorkerResources, job: TenantQueueRefreshJob) {
  try {
    for (;;) {
      const next = await r.db.transaction().execute(async (tx) => {
        const run = await tx
          .selectFrom('tenant_mail_policy_runs')
          .selectAll()
          .where('tenant_id', '=', job.tenant_id)
          .forUpdate()
          .executeTakeFirst();
        if (
          !run ||
          run.generation !== job.generation ||
          run.state === 'succeeded' ||
          !(await tenantQueuesEnabled(tx, job.tenant_id))
        )
          return null;
        const batch = await tx
          .selectFrom('threads')
          .select(['id', 'mailbox_id'])
          .where('tenant_id', '=', job.tenant_id)
          .where('deleted_at', 'is', null)
          .where('id', '>', run.after_thread_id ?? '00000000-0000-0000-0000-000000000000')
          .orderBy('id')
          .limit(500)
          .execute();
        await touchThreads(
          tx,
          batch.map((t) => t.id),
          'sync',
          null,
        );
        await tx
          .updateTable('tenant_mail_policy_runs')
          .set({
            state: batch.length ? 'running' : 'succeeded',
            after_thread_id: batch.at(-1)?.id ?? run.after_thread_id,
            processed: run.processed + batch.length,
            started_at: run.started_at ?? new Date(),
            finished_at: batch.length ? null : new Date(),
            updated_at: new Date(),
          })
          .where('tenant_id', '=', job.tenant_id)
          .where('generation', '=', job.generation)
          .execute();
        return batch;
      });
      if (!next?.length) return;
      for (const box of new Set(next.map((t) => t.mailbox_id)))
        emitThreads(
          r,
          box,
          next.filter((t) => t.mailbox_id === box).map((t) => t.id),
        );
    }
  } catch (error) {
    await r.db
      .updateTable('tenant_mail_policy_runs')
      .set({
        state: 'failed',
        error: 'Não foi possível concluir a atualização. Uma nova tentativa será realizada.',
        updated_at: new Date(),
      })
      .where('tenant_id', '=', job.tenant_id)
      .where('generation', '=', job.generation)
      .where('state', 'not in', ['superseded', 'succeeded'])
      .execute();
    throw error;
  }
}
