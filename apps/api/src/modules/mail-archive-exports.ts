import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { ZipFile } from 'yazl';
import { Storage, audit, type DB } from '@apmail/db';
import type { Selectable } from 'kysely';
import type { Address } from '@apmail/shared';
import { requireTenantAdmin, notFound } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';

type Message = Selectable<DB['messages']>;
export function toMbox(raw: Buffer, date: Date, sender: string) {
  // mboxrd: quote every From separator, including already quoted body lines.
  const escaped = raw
    .toString('latin1')
    .replace(/^(>*From )/gm, '>$1')
    .replace(/\r?\n/g, '\n');
  const from = sender.replace(/[^a-zA-Z0-9@._+-]/g, '') || 'apmail@localhost';
  return Buffer.from(
    `From ${from} ${date.toUTCString()}\n${escaped.replace(/\n*$/, '')}\n\n`,
    'latin1',
  );
}
async function mimeFor(r: Resources, storage: Storage, m: Message) {
  if (m.raw_storage_path) return storage.openReadStream(m.raw_storage_path);
  const attachments = await r.db
    .selectFrom('attachments')
    .selectAll()
    .where('message_id', '=', m.id)
    .where('tenant_id', '=', m.tenant_id)
    .execute();
  const files = [];
  for (const a of attachments)
    files.push({
      filename: a.filename,
      contentType: a.content_type,
      cid: a.content_id ?? undefined,
      contentDisposition: a.is_inline ? ('inline' as const) : ('attachment' as const),
      content: await storage.openReadStream(a.storage_path),
    });
  return new MailComposer({
    from: { name: m.from_name, address: m.from_address || 'unknown@localhost' },
    to: m.to_addresses as unknown as Address[],
    cc: m.cc_addresses as unknown as Address[],
    bcc: m.bcc_addresses as unknown as Address[],
    replyTo: m.reply_to_addresses as unknown as Address[],
    subject: m.subject,
    date: m.message_at,
    messageId: m.message_id_header,
    inReplyTo: m.in_reply_to ?? undefined,
    references: m.references_headers,
    text: m.body_text,
    html: m.body_html || undefined,
    attachments: files,
    headers: { 'X-APMail-Backup-Source': 'reconstructed', 'X-APMail-Message-ID': m.id },
  })
    .compile()
    .createReadStream();
}
export async function registerMailArchiveExports(app: FastifyInstance, r: Resources) {
  app.get(
    '/api/mailboxes/:id/archive-export',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const c = requireTenantAdmin(req.ctx),
        { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { format, folder_id } = z
        .object({ format: z.enum(['mbox', 'eml']).default('mbox'), folder_id: z.uuid().optional() })
        .parse(req.query);
      await requireMailboxPerm(c, r.db, id, 'read');
      const box = await r.db
        .selectFrom('mailboxes')
        .select(['name', 'email_address'])
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!box) throw notFound();
      if (
        folder_id &&
        !(await r.db
          .selectFrom('folders')
          .select('id')
          .where('id', '=', folder_id)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst())
      )
        throw notFound();
      const storage = new Storage(r.env.STORAGE_DIR, r.db),
        cutoff = new Date();
      let exported = 0;
      const signal = new AbortController();
      req.raw.on('aborted', () => signal.abort());
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) signal.abort();
      });
      async function* messages() {
        let cursor = '00000000-0000-0000-0000-000000000000';
        for (;;) {
          if (signal.signal.aborted) return;
          const rows = await r.db
            .selectFrom('messages')
            .selectAll()
            .where('tenant_id', '=', c.tenantId)
            .where('mailbox_id', '=', id)
            .where('deleted_at', 'is', null)
            .where('created_at', '<=', cutoff)
            .where('id', '>', cursor)
            .$if(!!folder_id, (q) => q.where('folder_id', '=', folder_id!))
            .orderBy('id')
            .limit(50)
            .execute();
          if (!rows.length) return;
          for (const row of rows) {
            yield row;
          }
          cursor = rows.at(-1)!.id;
        }
      }
      const safeName = box.email_address.replace(/[^a-z0-9@._-]/gi, '_');
      reply
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Disposition',
          `attachment; filename="${safeName}-${cutoff.toISOString().slice(0, 10)}.${format === 'eml' ? 'zip' : 'mbox'}"`,
        );
      const auditExport = () =>
        audit(r.db, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'mail.exported',
          entityType: 'mailbox',
          entityId: id,
          metadata: { format, exported, folder_id: folder_id ?? null },
          ip: c.ip,
        }).catch(() => app.log.warn({ mailbox_id: id }, 'Registro da exportação pendente.'));
      if (format === 'mbox') {
        reply.type('application/mbox');
        async function* output() {
          for await (const message of messages()) {
            const raw = await mimeFor(r, storage, message);
            const chunks: Buffer[] = [];
            for await (const chunk of raw)
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            yield toMbox(Buffer.concat(chunks), message.message_at, message.from_address);
            exported++;
          }
          if (!signal.signal.aborted) await auditExport();
        }
        return reply.send(Readable.from(output()));
      }
      const zip = new ZipFile();
      const zipStream = zip.outputStream as Readable;
      zipStream.on('error', () => undefined);
      signal.signal.addEventListener('abort', () => zipStream.destroy());
      // Wait for each source to be consumed before reading the next: bounded memory and backpressure.
      const produce = async () => {
        try {
          for await (const message of messages()) {
            if (signal.signal.aborted) break;
            const folder = message.folder_id
              ? await r.db
                  .selectFrom('folders')
                  .select('name')
                  .where('id', '=', message.folder_id)
                  .where('tenant_id', '=', c.tenantId)
                  .executeTakeFirst()
              : null;
            const directory = (folder?.name ?? 'Mensagens')
              .replace(/[^\p{L}\p{N}._ -]/gu, '_')
              .replace(/^\.+$/, 'Mensagens');
            await new Promise<void>((resolve, reject) => {
              let source: Readable | undefined;
              const aborted = () => {
                source?.destroy();
                reject(new Error('Download cancelado.'));
              };
              const ended = () => {
                signal.signal.removeEventListener('abort', aborted);
                resolve();
              };
              const failed = (error: Error) => {
                signal.signal.removeEventListener('abort', aborted);
                reject(error);
              };
              signal.signal.addEventListener('abort', aborted, { once: true });
              if (signal.signal.aborted) {
                aborted();
                return;
              }
              zip.addReadStreamLazy(
                `${directory}/${message.id}.eml`,
                { mtime: message.message_at },
                (callback) => {
                  void mimeFor(r, storage, message).then((stream) => {
                    source = stream;
                    stream.once('end', ended);
                    stream.once('error', failed);
                    if (signal.signal.aborted) {
                      stream.destroy();
                      callback(new Error('Download cancelado.'), stream);
                      return;
                    }
                    callback(null, stream);
                  }, failed);
                },
              );
            });
            exported++;
          }
          zip.end();
          if (!signal.signal.aborted) await auditExport();
        } catch (error) {
          zipStream.destroy(error instanceof Error ? error : new Error('Exportação interrompida.'));
        }
      };
      void produce();
      reply.type('application/zip');
      return reply.send(zip.outputStream);
    },
  );
}
