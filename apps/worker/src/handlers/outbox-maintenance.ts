import { sql } from 'kysely';
import { outboxJobId, sendJobOptions } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
export async function sweepOutbox(r: WorkerResources) {
  const stale = await r.db
    .selectFrom('outbox')
    .select(['id', 'submit_count'])
    .where('status', '=', 'sending')
    .where('updated_at', '<', new Date(Date.now() - 600000))
    .execute();
  for (const row of stale)
    await r.db
      .updateTable('outbox')
      .set({
        status: 'queued',
        submit_count: row.submit_count + 1,
        job_id: outboxJobId(row.id, row.submit_count + 1),
        send_after: new Date(),
      })
      .where('id', '=', row.id)
      .where('status', '=', 'sending')
      .where('updated_at', '<', new Date(Date.now() - 600000))
      .execute();
  const rows = await r.db
    .selectFrom('outbox')
    .selectAll()
    .where('status', 'in', ['queued', 'scheduled'])
    .execute();
  for (const row of rows) {
    if (!row.job_id) continue;
    const job = await r.queues['outbox-send'].getJob(row.job_id);
    if (job) {
      const state = await job.getState();
      if (['failed', 'completed'].includes(state)) await job.remove();
      else continue;
    }
    await r.queues['outbox-send'].add('send', { outbox_id: row.id }, sendJobOptions(row));
  }
}
export async function cleanupUploads(r: WorkerResources) {
  const files = await r.db
    .selectFrom('uploads')
    .selectAll()
    .where('consumed_at', 'is', null)
    .where('created_at', '<', new Date(Date.now() - 86400000))
    .where(
      sql<boolean>`not exists(select 1 from outbox o where o.status in ('draft','queued','scheduled','sending') and o.attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',uploads.id)))`,
    )
    .execute();
  for (const file of files) {
    await r.storage.removeFile(file.storage_path);
    await r.db
      .deleteFrom('uploads')
      .where('id', '=', file.id)
      .where('consumed_at', 'is', null)
      .execute();
  }
}
