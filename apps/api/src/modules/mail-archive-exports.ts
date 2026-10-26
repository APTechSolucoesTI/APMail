import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { ZipFile } from 'yazl';
import { Storage, audit, toMbox, backupMime, assertFilesClean } from '@apmail/db';
import { requireTenantAdmin, notFound } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';
import { registerPstExports } from './pst-exports.js';

export async function registerMailArchiveExports(app: FastifyInstance, r: Resources) {
  await registerPstExports(app, r);
  app.get(
    '/api/mailboxes/:id/archive-export',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const c = requireTenantAdmin(req.ctx, 'archives'),
        { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { format, folder_id, include_deleted } = z
        .object({
          format: z.enum(['mbox', 'eml']).default('mbox'),
          folder_id: z.uuid().optional(),
          include_deleted: z.enum(['true', 'false']).default('false'),
        })
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
            .$if(include_deleted !== 'true', (q) => q.where('deleted_at', 'is', null))
            .where((eb) =>
              eb.or([
                eb('raw_storage_path', 'is not', null),
                eb('body_text', '!=', ''),
                eb('body_html', 'is not', null),
              ]),
            )
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
      // Validate the entire selection before emitting an archive header or any
      // bytes. Page attachment lookups so a mailbox cannot exhaust API memory.
      let pageIds: string[] = [];
      let rawPaths: string[] = [];
      const checkPage = async () => {
        if (!pageIds.length) return;
        const attachments = await r.db
          .selectFrom('attachments')
          .select('storage_path')
          .where('tenant_id', '=', c.tenantId)
          .where('message_id', 'in', pageIds)
          .execute();
        await assertFilesClean(
          r.db,
          [...rawPaths, ...attachments.map((file) => file.storage_path)],
          storage,
        );
        pageIds = [];
        rawPaths = [];
      };
      for await (const message of messages()) {
        pageIds.push(message.id);
        if (message.raw_storage_path) rawPaths.push(message.raw_storage_path);
        if (pageIds.length === 50) await checkPage();
      }
      await checkPage();
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
          metadata: {
            format,
            exported,
            folder_id: folder_id ?? null,
            include_deleted: include_deleted === 'true',
          },
          ip: c.ip,
        }).catch(() => app.log.warn({ mailbox_id: id }, 'Registro da exportação pendente.'));
      if (format === 'mbox') {
        reply.type('application/mbox');
        async function* output() {
          for await (const message of messages()) {
            const raw = await backupMime(r.db, storage, message);
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
                  .select(['imap_path', 'delimiter'])
                  .where('id', '=', message.folder_id)
                  .where('tenant_id', '=', c.tenantId)
                  .executeTakeFirst()
              : null;
            const directory =
              (folder?.imap_path ?? 'Mensagens')
                .split(folder?.delimiter || '/')
                .flatMap((part) => part.split(/[\\/]+/))
                .filter(Boolean)
                .map((part) =>
                  part.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+$/, 'Mensagens'),
                )
                .join('/') || 'Mensagens';
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
                  void backupMime(r.db, storage, message).then((stream) => {
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

export { toMbox } from '@apmail/db';
