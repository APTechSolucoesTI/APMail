import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { Emitter } from '@socket.io/redis-emitter';
import type { Logger } from 'pino';
import type { createQueues, DB, Storage } from '@apmail/db';
import type { WorkerEnv } from './env.js';
export type WorkerResources = {
  db: Kysely<DB>;
  redis: Redis;
  queues: ReturnType<typeof createQueues>['queues'];
  io: Emitter;
  log: Logger;
  env: WorkerEnv;
  storage: Storage;
};
