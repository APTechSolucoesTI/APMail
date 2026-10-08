import { toBullJobId } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
export async function ensureSchedulers(r: WorkerResources) {
  const pendingArchives = await r.db
    .selectFrom('mail_archive_imports')
    .select('id')
    .where('state', 'in', ['queued', 'running'])
    .where('updated_at', '<', new Date(Date.now() - 300000))
    .execute();
  for (const task of pendingArchives)
    await r.queues['mail-archive'].add(
      'recover',
      { import_id: task.id },
      {
        jobId: toBullJobId('archive-recover:' + task.id),
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );
  const boxes = await r.db
    .selectFrom('mailboxes')
    .select(['id', 'status', 'deleted_at', 'receiving_protocol'])
    .execute();
  const sync = r.queues['mailbox-sync'],
    connection = r.queues['mailbox-connection'];
  const active = new Set(
    boxes
      .filter((b) => b.status === 'active' && !b.deleted_at && b.receiving_protocol !== 'local')
      .map((b) => b.id),
  );
  for (const scheduler of await sync.getJobSchedulers())
    if (scheduler.key.startsWith('sync:') && !active.has(scheduler.key.slice(5)))
      await sync.removeJobScheduler(scheduler.key);
  for (const id of active)
    await sync.upsertJobScheduler(
      'sync:' + id,
      { every: r.env.WORKER_SYNC_EVERY_SECONDS * 1000 },
      { name: 'sync', data: { mailbox_id: id } },
    );
  const jobs = await connection.getJobs(['waiting', 'active', 'delayed']);
  const pendingIds = new Set(jobs.map((job) => String(job.data.mailbox_id)));
  for (const box of boxes.filter(
    (b) => b.status === 'pending' && !b.deleted_at && !pendingIds.has(b.id),
  ))
    await connection.add(
      'test',
      { mailbox_id: box.id },
      { jobId: toBullJobId(`conn:${box.id}:${Date.now()}`), attempts: 1 },
    );
  const actions = await r.db
    .selectFrom('mail_actions')
    .select('id')
    .where('status', '=', 'pending')
    .where('created_at', '<', new Date(Date.now() - 300000))
    .execute();
  for (const a of actions)
    await r.queues['mail-actions'].add(
      'action',
      { action_id: a.id },
      {
        jobId: toBullJobId('action:' + a.id),
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );
}
