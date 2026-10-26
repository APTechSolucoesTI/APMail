import { sql } from 'kysely';
import { outboxJobId, sendJobOptions, advanceRecurringOutbox } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
export async function sweepOutbox(r: WorkerResources) {
  const recurring = await r.db
    .selectFrom('outbox as o')
    .innerJoin('mail_schedule_series as s', 's.id', 'o.recurrence_id')
    .select('o.id')
    .where('s.state', '=', 'active')
    .where('o.status', '=', 'sent')
    .where(
      sql<boolean>`not exists(select 1 from outbox later where later.recurrence_id=o.recurrence_id and later.recurrence_sequence>o.recurrence_sequence)`,
    )
    .limit(100)
    .execute();
  for (const row of recurring)
    try {
      await advanceRecurringOutbox(r.db, row.id);
    } catch {
      r.log.warn({ outbox_id: row.id }, 'Recorrência aguardando recuperação.');
    }
  const stale = await r.db
    .selectFrom('outbox')
    .select(['id', 'submit_count', 'mdn_original_message_id'])
    .where('status', '=', 'sending')
    .where('updated_at', '<', new Date(Date.now() - 600000))
    .execute();
  for (const row of stale)
    if (row.mdn_original_message_id)
      await r.db
        .updateTable('outbox')
        .set({
          status: 'failed',
          last_error:
            'Não foi possível determinar se o SMTP aceitou a confirmação. Ela não será repetida.',
        })
        .where('id', '=', row.id)
        .where('status', '=', 'sending')
        .where('updated_at', '<', new Date(Date.now() - 600000))
        .execute();
    else
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
      sql<boolean>`exists(select 1 from file_security f where f.storage_key=uploads.storage_path and f.status='clean')`,
    )
    .where(
      sql<boolean>`not exists(select 1 from outbox o where o.status in ('draft','queued','scheduled','sending','failed') and o.attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',uploads.id)))`,
    )
    .execute();
  for (const file of files) {
    await r.db.transaction().execute(async (tx) => {
      // A concurrent reanalysis must not turn automatic retention into deletion
      // of a newly quarantined file. Hold the verdict while removing clean bytes.
      const clean = await sql<{ id: string }>`select id from file_security
        where storage_key=${file.storage_path} and status='clean' for update`.execute(tx);
      if (!clean.rows.length) return;
      await r.storage.withDatabase(tx).removeFile(file.storage_path);
      await tx
        .deleteFrom('uploads')
        .where('id', '=', file.id)
        .where('consumed_at', 'is', null)
        .execute();
    });
  }
}
