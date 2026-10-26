import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkerResources } from '../src/resources.js';
import { ensureSchedulers } from '../src/handlers/ensure-schedulers.js';
const security = vi.hoisted(() => ({ sweepSecurityFiles: vi.fn() }));
vi.mock('@apmail/db', async (original) => ({ ...(await original<object>()), ...security }));
beforeEach(() => vi.resetAllMocks());
it('recria o agendamento da verificação após perda das filas e solicita recuperação persistente', async () => {
  const scheduled: string[] = [],
    added: unknown[] = [];
  const q = {
    select: () => q,
    where: () => q,
    execute: async () => [],
    executeTakeFirst: async () => undefined,
  };
  const queue = {
    upsertJobScheduler: async (id: string, schedule: unknown, job: unknown) => {
      scheduled.push(id);
      return { schedule, job };
    },
    getJobSchedulers: async () => [],
    getJobs: async () => [],
    add: async (...args: unknown[]) => {
      added.push(args);
    },
  };
  const r = {
    db: { selectFrom: () => q },
    queues: {
      'antivirus-scan': queue,
      'mail-archive': queue,
      maintenance: queue,
      'mailbox-sync': queue,
      'mailbox-connection': queue,
      'mail-actions': queue,
    },
    env: { WORKER_SYNC_EVERY_SECONDS: 60 },
  } as unknown as WorkerResources;
  await ensureSchedulers(r);
  expect(scheduled).toContain('antivirus-sweep');
  expect(added).toContainEqual([
    'sweep',
    { sweep: true },
    {
      jobId: 'antivirus-recovery',
      removeOnComplete: true,
      removeOnFail: true,
    },
  ]);
});
