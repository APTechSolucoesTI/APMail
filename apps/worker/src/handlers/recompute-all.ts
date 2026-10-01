import { touchThreads } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { emitThreads } from '../lib/events.js';
export async function recomputeAll(r: WorkerResources) {
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const batch = await r.db
      .selectFrom('threads')
      .select(['id', 'mailbox_id'])
      .where('id', '>', after)
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .limit(500)
      .execute();
    if (!batch.length) break;
    await r.db.transaction().execute((tx) =>
      touchThreads(
        tx,
        batch.map((t) => t.id),
        'sync',
        null,
      ),
    );
    const boxes = new Set(batch.map((t) => t.mailbox_id));
    for (const boxId of boxes)
      emitThreads(
        r,
        boxId,
        batch.filter((t) => t.mailbox_id === boxId).map((t) => t.id),
      );
    after = batch.at(-1)!.id;
  }
  await r.redis.set('apmail:recompute:v5', 'done');
}
