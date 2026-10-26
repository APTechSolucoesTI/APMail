import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkerResources } from '../src/resources.js';
import { handleOutboxSend } from '../src/handlers/outbox-send.js';
const boundaries = vi.hoisted(() => ({
  buildMime: vi.fn(),
  transports: vi.fn(),
  registerSecurityFile: vi.fn(),
  inheritFileSecurity: vi.fn(),
  FileSecurityError: class extends Error {
    constructor(public code: string) {
      super('Arquivo bloqueado para envio.');
    }
  },
}));
vi.mock('@apmail/db', async (original) => ({
  ...(await original<object>()),
  registerSecurityFile: boundaries.registerSecurityFile,
  inheritFileSecurity: boundaries.inheritFileSecurity,
  FileSecurityError: boundaries.FileSecurityError,
  audit: async () => undefined,
  touchThreads: async () => undefined,
  resolveThread: async () => 'thread',
  lockStorageTenant: async () => undefined,
  assertStorageCapacity: async () => undefined,
}));
vi.mock('../src/outbox/build-mime.js', () => ({ buildMime: boundaries.buildMime }));
vi.mock('../src/imap/connect.js', () => ({ transports: boundaries.transports }));
vi.mock('../src/lib/mailbox-permissions.js', () => ({ userCanMailbox: async () => true }));
vi.mock('../src/lib/mailbox-lock.js', () => ({
  withMailboxLock: async (
    _redis: unknown,
    _box: unknown,
    _job: unknown,
    work: () => Promise<unknown>,
  ) => work(),
}));
function resources() {
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const copied: string[] = [];
  const row = {
    id: 'outbox',
    tenant_id: 'tenant',
    mailbox_id: 'box',
    created_by: 'owner',
    status: 'sending',
    attachments: [],
    attempts: 1,
    kind: 'new',
    to_addresses: [],
    cc_addresses: [],
    bcc_addresses: [],
    body_html: '',
    subject: 'Mensagem',
    submit_count: 1,
  };
  const box = {
    id: 'box',
    tenant_id: 'tenant',
    status: 'active',
    receiving_protocol: 'local',
    email_address: 'qa@example.test',
    aliases: [],
  };
  const values: Record<string, unknown> = {
    tenants: { id: 'tenant', settings: {} },
    mailboxes: box,
    tenant_members: { role: 'owner', status: 'active' },
    mailbox_members: { role: 'admin' },
    folders: { id: 'sent', imap_path: 'Enviados' },
  };
  const query = (table: string, transaction: boolean, updating = false) => {
    const q = {
      select: () => q,
      selectAll: () => q,
      where: () => q,
      returningAll: () => q,
      values: () => q,
      returning: () => q,
      set: (value: Record<string, unknown>) => {
        updates.push({ table, values: value });
        return q;
      },
      execute: async () => [],
      executeTakeFirst: async () => (updating && !transaction ? row : values[table]),
    };
    return q;
  };
  const tx = {
    selectFrom: (t: string) => query(t, true),
    insertInto: (t: string) => query(t, true),
    updateTable: (t: string) => query(t, true, true),
  };
  const db = {
    selectFrom: (t: string) => query(t, false),
    updateTable: (t: string) => query(t, false, true),
    transaction: () => ({ execute: (fn: (value: unknown) => Promise<unknown>) => fn(tx) }),
  };
  const storage = {
    withDatabase: () => storage,
    copyFile: async (_from: string, path: string) => {
      copied.push(path);
    },
    removeFile: async () => undefined,
  };
  return {
    r: {
      db,
      storage,
      io: { to: () => ({ emit: () => undefined }) },
      log: { warn: vi.fn() },
    } as unknown as WorkerResources,
    updates,
    copied,
    tx,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  boundaries.transports.mockResolvedValue({
    smtp: { sendMail: async () => undefined },
    close: async () => undefined,
  });
});
it.each(['file_pending', 'file_scan_error'])(
  'preserva motivo de segurança legível e tenta novamente para %s',
  async (code) => {
    const { r, updates } = resources();
    boundaries.buildMime.mockRejectedValue(new boundaries.FileSecurityError(code));
    await expect(
      handleOutboxSend(r, 'outbox', { id: 'job', attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow('Arquivo bloqueado para envio.');
    expect(updates).toContainEqual({
      table: 'outbox',
      values: { status: 'queued', last_error: 'Arquivo bloqueado para envio.' },
    });
    expect(boundaries.transports).not.toHaveBeenCalled();
  },
);
it('encerra envio infectado sem abrir transporte nem gastar tentativas adicionais', async () => {
  const { r, updates } = resources();
  boundaries.buildMime.mockRejectedValue(new boundaries.FileSecurityError('file_infected'));
  await expect(
    handleOutboxSend(r, 'outbox', { id: 'job', attemptsMade: 0, opts: { attempts: 3 } }),
  ).rejects.toMatchObject({ name: 'UnrecoverableError', message: 'Arquivo bloqueado para envio.' });
  expect(updates).toContainEqual({
    table: 'outbox',
    values: { status: 'failed', last_error: 'Arquivo bloqueado para envio.' },
  });
  expect(boundaries.transports).not.toHaveBeenCalled();
});
it('preserva evidência limpa e metadados na cópia enviada antes de SMTP', async () => {
  const { r, tx, copied } = resources();
  const file = {
    filename: 'documento.pdf',
    content_type: 'application/pdf',
    size_bytes: 42,
    storage_path: 'uploads/clean',
    content_id: null,
    is_inline: false,
    upload_id: null,
  };
  boundaries.buildMime.mockResolvedValue({
    raw: Buffer.from('MIME'),
    bodyText: 'Teste',
    bodyHtml: '<p>Teste</p>',
    messageId: '<qa@example.test>',
    inReplyTo: null,
    references: [],
    files: [file],
    fromName: 'QA',
    fromAddress: 'qa@example.test',
    envelope: { from: 'qa@example.test', to: ['to@example.test'] },
  });
  let verified = false;
  boundaries.inheritFileSecurity.mockImplementation(async (value, source, destination) => {
    expect(value).toBe(tx);
    expect(source).toBe('uploads/clean');
    expect(copied).toContain(destination);
    verified = true;
  });
  boundaries.transports.mockResolvedValue({
    close: async () => undefined,
    smtp: {
      sendMail: async () => {
        expect(verified).toBe(true);
      },
    },
  });
  await handleOutboxSend(r, 'outbox', { id: 'job', attemptsMade: 0, opts: { attempts: 3 } });
  expect(boundaries.registerSecurityFile).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      tenant_id: 'tenant',
      mailbox_id: 'box',
      kind: 'attachment',
      filename: 'documento.pdf',
      content_type: 'application/pdf',
      size_bytes: 42,
      storage_key: copied[0],
    }),
  );
  expect(verified).toBe(true);
});
