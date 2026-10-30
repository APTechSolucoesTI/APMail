import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, type QueueName } from '@apmail/shared';

/** Prioritized jobs wait in a separate Redis set, but are still pending work. */
export async function queueHealthCounts(queue: Queue) {
  const counts = await queue.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed');
  return {
    waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  };
}
export function createQueues(redisUrl: string): {
  queues: Record<QueueName, Queue>;
  connection: Redis;
  close: () => Promise<void>;
} {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = Object.fromEntries(
    QUEUE_NAMES.map((name) => [
      name,
      new Queue(name, {
        connection,
        prefix: 'apmail',
        defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
      }),
    ]),
  ) as Record<QueueName, Queue>;
  return {
    queues,
    connection,
    close: async () => {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
      await connection.quit();
    },
  };
}
