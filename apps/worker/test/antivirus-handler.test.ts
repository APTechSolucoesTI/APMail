import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkerResources } from '../src/resources.js';
import { handleAntivirus } from '../src/handlers/antivirus.js';
const scans = vi.hoisted(() => ({
  antivirusOptions: vi.fn(),
  scanSecurityFile: vi.fn(),
  sweepSecurityFiles: vi.fn(),
  refreshAntivirusHealth: vi.fn(),
}));
vi.mock('@apmail/db', async (original) => ({ ...(await original<object>()), ...scans }));
beforeEach(() => vi.resetAllMocks());
it('o sweep recupera tarefas persistentes mesmo com motor offline', async () => {
  scans.refreshAntivirusHealth.mockResolvedValue({ status: 'offline' });
  scans.sweepSecurityFiles.mockResolvedValue(2);
  const r = { db: {}, queues: { 'antivirus-scan': {} }, env: {} } as unknown as WorkerResources;
  expect(await handleAntivirus(r, { sweep: true })).toBe(2);
  expect(scans.sweepSecurityFiles).toHaveBeenCalledWith(r.db, r.queues['antivirus-scan']);
});
it('publica atualização de anexos e composição após finalizar o veredito', async () => {
  const events: { room: string; event: string; data: unknown }[] = [];
  scans.scanSecurityFile.mockResolvedValue({
    mailbox_id: 'box',
    user_id: 'user',
    message_id: 'message',
    status: 'infected',
  });
  const r = {
    db: {},
    storage: {},
    env: {},
    io: {
      to: (room: string) => ({
        emit: (event: string, data: unknown) => events.push({ room, event, data }),
      }),
    },
  } as unknown as WorkerResources;
  await handleAntivirus(r, { id: 'file' });
  expect(events).toContainEqual({
    room: 'mailbox:box',
    event: 'attachments:changed',
    data: { mailbox_id: 'box', message_id: 'message' },
  });
  expect(events).toContainEqual({
    room: 'user:user',
    event: 'outbox:changed',
    data: { mailbox_id: 'box' },
  });
});
