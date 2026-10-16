import { createHash, randomUUID } from 'node:crypto';
import { runMeetSyncPage, scheduleMeetSync } from '@apmail/db';
import { meetJobSchema, type MeetJob } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
export async function handleGoogleMeet(r: WorkerResources, input: unknown) {
  const enqueue = async (payload: MeetJob) => {
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await r.queues['google-meet-sync'].add(payload.kind, payload, {
      jobId: 'meet~' + digest,
      attempts: 4,
      backoff: { type: 'exponential', delay: 30000 },
    });
  };
  if (input && typeof input === 'object' && 'sweep' in input)
    return scheduleMeetSync(r.db, enqueue, r.env.GOOGLE_MEET_SYNC_MINUTES);
  const job = meetJobSchema.parse(input),
    key =
      'google-meet-lock:' +
      createHash('sha256')
        .update(job.connection_id + job.kind + job.resource + (job.page_token ?? ''))
        .digest('hex'),
    nonce = randomUUID();
  if (!(await r.redis.set(key, nonce, 'EX', 120, 'NX'))) throw new Error('google_meet_sync_busy');
  try {
    await runMeetSyncPage(r.db, r.env, job, enqueue);
  } finally {
    const owner = await r.db
      .selectFrom('google_connections')
      .select('user_id')
      .where('id', '=', job.connection_id)
      .executeTakeFirst();
    if (owner) r.io.to('user:' + owner.user_id).emit('google-meet:changed', {});
    await r.redis.eval(
      'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end',
      1,
      key,
      nonce,
    );
  }
}
