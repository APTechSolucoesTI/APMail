import type { WorkerResources } from '../resources.js';
export function emitThreads(r: WorkerResources, mailboxId: string, threadIds: string[]) {
  const ids = [...new Set(threadIds)];
  r.io
    .to('mailbox:' + mailboxId)
    .emit('threads:changed', { mailbox_id: mailboxId, thread_ids: ids });
  r.io.to('mailbox:' + mailboxId).emit('queue-counts:changed', { mailbox_id: mailboxId });
  for (const thread_id of ids)
    r.io.to('thread:' + thread_id).emit('thread:messages-changed', { thread_id });
}
