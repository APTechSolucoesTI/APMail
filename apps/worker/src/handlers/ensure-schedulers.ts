import { toBullJobId } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import { ensureAntivirusScheduler } from './antivirus.js';
import { enqueueMailboxRecovery } from './mailbox-health.js';
export async function ensureSchedulers(r: WorkerResources) {
  await ensureAntivirusScheduler(r);
  const exports = await r.db
    .selectFrom('mail_archive_exports')
    .select('id')
    .where('state', 'in', ['queued', 'staging', 'converting'])
    .where('updated_at', '<', new Date(Date.now() - 300000))
    .execute();
  for (const task of exports)
    await r.queues['mail-archive'].add(
      'export-pst-recover',
      { export_id: task.id },
      {
        jobId: toBullJobId('pst-recover:' + task.id),
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );
  const purge = await r.db
    .selectFrom('mailbox_purge_requests')
    .select('mailbox_id')
    .where('state', '!=', 'completed')
    .executeTakeFirst();
  if (purge)
    await r.queues.maintenance.add(
      'purge-mailboxes',
      {},
      { jobId: 'mailbox-purge-recover', removeOnComplete: true, removeOnFail: true },
    );
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
    .innerJoin('tenants as t', 't.id', 'mailboxes.tenant_id')
    .select([
      'mailboxes.id',
      'mailboxes.status',
      'mailboxes.deleted_at',
      'receiving_protocol',
      'connection_revision',
      'connection_failures',
      'connection_failed_at',
      'next_connection_attempt_at',
    ])
    .where('t.deleted_at', 'is', null)
    .where('t.suspended_at', 'is', null)
    .execute();
  const sync = r.queues['mailbox-sync'];
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
  for (const box of boxes.filter(
    (b) =>
      ['pending', 'error'].includes(b.status) && !b.deleted_at && b.receiving_protocol !== 'local',
  ))
    await enqueueMailboxRecovery(r, box);
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
