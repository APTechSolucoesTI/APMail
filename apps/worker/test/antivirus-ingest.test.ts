import { beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { WorkerResources } from '../src/resources.js';
import type { Mailbox } from '../src/imap/connect.js';
import type { DB } from '@apmail/db';
import type { Selectable } from 'kysely';
import { ingestMessage } from '../src/imap/ingest-message.js';
const security = vi.hoisted(() => ({
  registerSecurityFile: vi.fn(),
  enqueueSecurityScan: vi.fn(),
}));
vi.mock('@apmail/db', async (original) => ({
  ...(await original<object>()),
  ...security,
  resolveThread: async () => 'thread',
  touchThreads: async () => undefined,
  lockStorageTenant: async () => undefined,
  assertStorageCapacity: async () => undefined,
}));
const box = {
  id: 'box',
  tenant_id: 'tenant',
  email_address: 'qa@example.test',
  aliases: [],
  import_started_at: null,
  history_classify_days: 0,
} as unknown as Mailbox;
const folder = {
  id: 'inbox',
  special_use: 'inbox',
  initial_uid_end: null,
} as unknown as Selectable<DB['folders']>;
function resources() {
  let committed = false;
  const persisted: string[] = [];
  const query = (transaction: boolean) => {
    const q = {
      select: () => q,
      selectAll: () => q,
      where: () => q,
      values: () => q,
      set: () => q,
      $if: () => q,
      execute: async () => [],
      executeTakeFirst: async () => (transaction ? { id: 'box' } : undefined),
    };
    return q;
  };
  const tx = {
    selectFrom: () => query(true),
    insertInto: () => query(true),
    updateTable: () => query(true),
  };
  const db = {
    selectFrom: () => query(false),
    transaction: () => ({
      execute: async (fn: (value: unknown) => Promise<unknown>) => {
        const result = await fn(tx);
        committed = true;
        return result;
      },
    }),
  };
  const storage = {
    withDatabase: () => storage,
    writeFile: async (path: string) => {
      persisted.push(path);
    },
    removeFile: async () => undefined,
  };
  return {
    r: {
      db,
      storage,
      queues: { 'antivirus-scan': {} },
      log: { warn: vi.fn() },
      io: { to: () => ({ emit: () => undefined }) },
    } as unknown as WorkerResources,
    tx,
    persisted,
    committed: () => committed,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  security.enqueueSecurityScan.mockResolvedValue(undefined);
  security.registerSecurityFile.mockImplementation(async (_tx, file) => ({
    id: file.storage_key,
    generation: 1,
    status: 'pending',
  }));
});
it('grava cada anexo inline e comum pendente na mesma transação e enfileira após commit', async () => {
  const { r, tx, persisted, committed } = resources();
  const source = await readFile(new URL('./fixtures/attachments.eml', import.meta.url));
  security.registerSecurityFile.mockImplementation(async (value, file) => {
    expect(value).toBe(tx);
    expect(committed()).toBe(false);
    expect(persisted).toContain(file.storage_key);
    return { id: file.storage_key, generation: 1, status: 'pending' };
  });
  security.enqueueSecurityScan.mockImplementation(async () => {
    expect(committed()).toBe(true);
  });
  await expect(
    ingestMessage(r, box, folder, { seq: 1, uid: 1, source, size: source.length }),
  ).resolves.toBe('thread');
  expect(security.registerSecurityFile).toHaveBeenCalledTimes(2);
  expect(security.enqueueSecurityScan).toHaveBeenCalledTimes(2);
  for (const call of security.registerSecurityFile.mock.calls)
    expect(call[1]).toMatchObject({
      tenant_id: 'tenant',
      mailbox_id: 'box',
      kind: 'attachment',
    });
});
it('mantém a mensagem recebida quando o Redis falha após o commit dos anexos pendentes', async () => {
  const { r, committed } = resources();
  security.enqueueSecurityScan.mockRejectedValue(new Error('Redis indisponível'));
  const source = await readFile(new URL('./fixtures/attachments.eml', import.meta.url));
  await expect(ingestMessage(r, box, folder, { seq: 1, uid: 1, source })).resolves.toBe('thread');
  expect(committed()).toBe(true);
  expect(security.registerSecurityFile).toHaveBeenCalledTimes(2);
  expect(security.enqueueSecurityScan).toHaveBeenCalledTimes(2);
});

it.each(['pop3', 'archive'] as const)(
  'registra também o MIME bruto de %s para bloquear exportação insegura',
  async (kind) => {
    const { r } = resources();
    const source = await readFile(new URL('./fixtures/attachments.eml', import.meta.url));
    await ingestMessage(
      r,
      box,
      folder,
      { seq: 1, uid: 1, source },
      { kind, key: 'key', historical: true },
    );
    expect(security.registerSecurityFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'mail_raw',
        filename: 'message.eml',
        content_type: 'message/rfc822',
        size_bytes: source.length,
        storage_key: expect.stringMatching(/^mail-raw\//),
      }),
    );
    expect(security.enqueueSecurityScan).toHaveBeenCalledTimes(3);
  },
);
