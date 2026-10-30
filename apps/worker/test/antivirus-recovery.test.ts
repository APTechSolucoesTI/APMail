import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkerResources } from '../src/resources.js';
import { ensureAntivirusScheduler } from '../src/handlers/antivirus.js';

const security = vi.hoisted(() => ({
  antivirusOptions: vi.fn(() => ({})),
  refreshAntivirusHealth: vi.fn(),
  sweepSecurityFiles: vi.fn(),
}));
vi.mock('@apmail/db', async (original) => ({ ...(await original<object>()), ...security }));
beforeEach(() => vi.resetAllMocks());

it('recupera pausa persistida e atualiza saúde e pendências sem aguardar o backlog', async () => {
  let paused = true;
  const queue = {
    resume: async () => {
      paused = false;
    },
    upsertJobScheduler: vi.fn(),
    add: vi.fn(),
  };
  security.refreshAntivirusHealth.mockResolvedValue({ status: 'offline' });
  security.sweepSecurityFiles.mockResolvedValue(100);
  const r = { db: {}, env: {}, queues: { 'antivirus-scan': queue } } as unknown as WorkerResources;

  await ensureAntivirusScheduler(r);

  expect(paused).toBe(false);
  expect(security.refreshAntivirusHealth).toHaveBeenCalledWith(r.db, expect.anything());
  expect(security.sweepSecurityFiles).toHaveBeenCalledWith(r.db, queue);
});
