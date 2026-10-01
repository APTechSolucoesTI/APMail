import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import type { DB, createQueues } from '@apmail/db';
import type { ApiEnv } from '../env.js';
export type Resources = {
  db: Kysely<DB>;
  redis: Redis;
  io: Server;
  queues: ReturnType<typeof createQueues>['queues'];
  env: ApiEnv;
};
