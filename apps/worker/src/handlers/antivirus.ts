import {
  antivirusOptions,
  scanSecurityFile,
  sweepSecurityFiles,
  refreshAntivirusHealth,
} from '@apmail/db';
import type { QueuePayloads } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';

export async function ensureAntivirusScheduler(r: WorkerResources) {
  const queue = r.queues['antivirus-scan'];
  await queue.upsertJobScheduler(
    'antivirus-sweep',
    { every: 60000 },
    { name: 'sweep', data: { sweep: true } },
  );
  await queue.add(
    'sweep',
    { sweep: true },
    {
      jobId: 'antivirus-recovery',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function handleAntivirus(
  r: WorkerResources,
  payload: QueuePayloads['antivirus-scan'],
) {
  const options = antivirusOptions(r.env);
  if (payload.sweep) {
    await refreshAntivirusHealth(r.db, options);
    return sweepSecurityFiles(r.db, r.queues['antivirus-scan']);
  }
  if (!payload.id) return;
  const file = await scanSecurityFile(r.db, r.storage, payload.id, options);
  if (file?.mailbox_id)
    r.io.to('mailbox:' + file.mailbox_id).emit('attachments:changed', {
      mailbox_id: file.mailbox_id,
      message_id: file.message_id,
    });
  if (file?.user_id)
    r.io.to('user:' + file.user_id).emit('outbox:changed', {
      mailbox_id: file.mailbox_id,
    });
}
