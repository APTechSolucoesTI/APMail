import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '@apmail/db';
import type { WorkerResources } from '../src/resources.js';
import { handlePstExport } from '../src/handlers/pst-export.js';
const security = vi.hoisted(() => ({
  registerSecurityFile: vi.fn(),
  enqueueSecurityScan: vi.fn(),
}));
vi.mock('@apmail/db', async (original) => ({
  ...(await original<object>()),
  ...security,
  lockStorageTenant: async () => undefined,
  observeStorageFile: async () => undefined,
  assertStorageCapacity: async () => undefined,
  audit: async () => undefined,
}));
vi.mock('../src/lib/mailbox-lock.js', () => ({
  withMailboxLock: async (
    _redis: unknown,
    _box: unknown,
    _job: unknown,
    work: () => Promise<unknown>,
  ) => work(),
}));
const dir = await mkdtemp(join(tmpdir(), 'apmail-pst-security-'));
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.resetAllMocks();
  security.registerSecurityFile.mockResolvedValue({ id: 'scan', generation: 1, status: 'pending' });
  security.enqueueSecurityScan.mockResolvedValue(undefined);
});
it.each([false, true])(
  'registra PST finalizado e preserva geração quando falha de fila=%s',
  async (queueFailure) => {
    const converter = join(dir, 'fake-converter.cjs');
    await writeFile(
      converter,
      `const fs=require('node:fs'),path=require('node:path');
    const output=process.argv[process.argv.indexOf('--output')+1];
    fs.mkdirSync(output,{recursive:true});const filename=path.join(output,'backup.pst');
    fs.writeFileSync(filename,Buffer.from('PST-finalizado'));
    process.stdout.write(JSON.stringify({type:'done',converted:0,skipped:0,warnings:0,outputs:[filename]})+'\\n');`,
    );
    const task = {
      id: 'export',
      tenant_id: 'tenant',
      mailbox_id: 'box',
      filename: 'backup.pst',
      state: 'queued',
      prepared: 0,
      include_deleted: false,
      cutoff_at: new Date(),
      created_by: 'user',
    };
    const outputs: { storage_path: string; kind: string }[] = [];
    let committed = false;
    const states: string[] = [];
    const q = (table: string, tx = false) => {
      let values: { storage_path?: string; kind?: string } = {};
      const query = {
        select: () => query,
        selectAll: () => query,
        innerJoin: () => query,
        where: () => query,
        $if: () => query,
        limit: () => query,
        orderBy: () => query,
        set: (value: { state?: string }) => {
          if (value.state) states.push(value.state);
          return query;
        },
        returning: () => query,
        values: (value: typeof values) => {
          values = value;
          return query;
        },
        executeTakeFirst: async () => (table === 'mail_archive_exports' ? task : { id: task.id }),
        execute: async () => {
          if (table === 'mail_archive_export_files' && values.storage_path && values.kind) {
            outputs.push({ storage_path: values.storage_path, kind: values.kind });
            return [];
          }
          return table === 'mail_archive_export_files' ? outputs : [];
        },
      };
      void tx;
      return query;
    };
    const tx = { insertInto: (t: string) => q(t, true) };
    const db = {
      selectFrom: (t: string) => q(t),
      insertInto: (t: string) => q(t),
      updateTable: (t: string) => q(t),
      deleteFrom: (t: string) => q(t),
      transaction: () => ({
        execute: async (fn: (value: unknown) => Promise<unknown>) => {
          const value = await fn(tx);
          committed = true;
          return value;
        },
      }),
    };
    security.registerSecurityFile.mockImplementation(async (value, file) => {
      expect(value).toBe(tx);
      expect(file.kind).toBe('mail_export');
      return { id: 'scan', generation: 1, status: 'pending' };
    });
    security.enqueueSecurityScan.mockImplementation(async () => {
      expect(committed).toBe(true);
      if (queueFailure) throw new Error('Redis indisponível');
    });
    const r = {
      db,
      storage: new Storage(dir),
      queues: { 'antivirus-scan': {} },
      env: { STORAGE_DIR: dir, PST_EXPORT_COMMAND: process.execPath, PST_EXPORT_DLL: converter },
      io: { to: () => ({ emit: () => undefined }) },
      log: { warn: vi.fn() },
    } as unknown as WorkerResources;
    await handlePstExport(r, task.id, 'job');
    expect(security.registerSecurityFile).toHaveBeenCalledOnce();
    expect(security.registerSecurityFile).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        storage_key: 'mail-exports/tenant/box/export/output/backup.pst',
        tenant_id: 'tenant',
        mailbox_id: 'box',
        filename: 'backup.pst',
        kind: 'mail_export',
        content_type: 'application/vnd.ms-outlook',
        size_bytes: 14,
      }),
    );
    expect(security.enqueueSecurityScan).toHaveBeenCalledOnce();
    expect(states).toContain('ready');
    expect(states).not.toContain('failed');
  },
);
