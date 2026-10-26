import { beforeEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { OutboxRow } from '@apmail/db';
import type { WorkerResources } from '../src/resources.js';
import type { Mailbox } from '../src/imap/connect.js';
import { buildMime } from '../src/outbox/build-mime.js';

const security = vi.hoisted(() => ({
  assertFilesClean: vi.fn<(...args: unknown[]) => Promise<void>>(),
  resolveOutboxAttachments: vi.fn(),
  prepareSignature: vi.fn(),
}));
vi.mock('@apmail/db', async (original) => ({
  ...(await original<object>()),
  ...security,
}));

const attachment = {
  id: 'attachment',
  filename: 'relatorio.txt',
  content_type: 'text/plain',
  size_bytes: 4,
  storage_path: 'uploads/report',
  is_inline: false,
  content_id: null,
  upload_id: 'upload',
};
const image = {
  id: 'signature',
  content_type: 'image/png',
  size_bytes: 4,
  storage_path: 'signatures/image',
};
const row = {
  tenant_id: 'tenant',
  mailbox_id: 'mailbox',
  created_by: 'user',
  kind: 'new',
  attachments: [],
  body_html: '<p>Mensagem</p>',
  to_addresses: [{ address: 'to@example.test' }],
  cc_addresses: [],
  bcc_addresses: [],
  subject: 'Teste',
  priority: 'normal',
  id: 'outbox',
  message_id_header: '<qa@example.test>',
} as unknown as OutboxRow;
const box = {
  email_address: 'from@example.test',
  aliases: [],
  from_name_template: '{{user_name}}',
} as unknown as Mailbox;
function resources() {
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirstOrThrow: async () => ({ full_name: 'QA', name: 'Empresa' }),
  };
  const opened: string[] = [];
  const r = {
    db: { selectFrom: () => query },
    storage: {
      openReadStream: async (path: string) => {
        opened.push(path);
        return Readable.from(Buffer.from('safe'));
      },
    },
  } as unknown as WorkerResources;
  return { r, opened };
}
beforeEach(() => {
  vi.resetAllMocks();
  security.resolveOutboxAttachments.mockImplementation(async () => [{ ...attachment }]);
  security.prepareSignature.mockResolvedValue({ bodyHtml: '<p>Mensagem</p>', images: [image] });
});
it.each(['file_pending', 'file_infected', 'file_scan_error'])(
  'não abre bytes para SMTP quando o anexo tem estado %s',
  async (code) => {
    const { r, opened } = resources();
    const error = Object.assign(new Error('Arquivo indisponível para envio.'), { code });
    security.assertFilesClean.mockRejectedValue(error);
    await expect(buildMime(r, row, box)).rejects.toBe(error);
    expect(opened).toEqual([]);
  },
);
it('inclui imagens de assinatura e anexos no bloqueio antes de construir MIME', async () => {
  const { r, opened } = resources();
  security.assertFilesClean.mockImplementation(async (_db, keys) => {
    expect(opened).toEqual([]);
    expect(keys).toEqual(['uploads/report', 'signatures/image']);
  });
  const mime = await buildMime(r, row, box);
  expect(mime.raw.toString()).toContain('relatorio.txt');
  expect(opened).toEqual(['uploads/report', 'signatures/image']);
  expect(security.assertFilesClean).toHaveBeenCalledOnce();
});
