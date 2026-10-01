import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, type QueueName } from '@apmail/shared';
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
