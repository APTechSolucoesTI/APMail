import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { Storage, audit, assertStorageGrowth, lockStorageTenant } from '@apmail/db';
import { requireTenantAdmin, notFound, conflict, ApiError } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';

export async function registerPstExports(app: FastifyInstance, r: Resources) {
  const authorize = async (context: Parameters<typeof requireTenantAdmin>[0], params: unknown) => {
    const c = requireTenantAdmin(context);
    const parsed = z
      .object({ id: z.uuid(), taskId: z.uuid().optional(), fileId: z.uuid().optional() })
      .parse(params);
    await requireMailboxPerm(c, r.db, parsed.id, 'read');
    const box = await r.db
      .selectFrom('mailboxes')
      .select(['id', 'email_address'])
      .where('id', '=', parsed.id)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box) throw notFound();
    return { c, box, ...parsed };
  };
  const queue = async (id: string) => {
    try {
      await r.queues['mail-archive'].add(
        'export-pst',
        { export_id: id },
        { attempts: 3, backoff: { type: 'exponential', delay: 10000 } },
      );
    } catch {
      await r.db
        .updateTable('mail_archive_exports')
        .set({
          state: 'failed',
          last_error: 'A fila está indisponível. Tente gerar novamente.',
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('state', '=', 'queued')
        .execute();
      throw new ApiError(
        503,
        'export_queue_unavailable',
        'A fila está temporariamente indisponível. Tente novamente.',
      );
    }
  };
  app.get('/api/mailboxes/:id/archive-exports', async (req) => {
    const { c, id } = await authorize(req.ctx, req.params);
    const tasks = await r.db
      .selectFrom('mail_archive_exports')
      .select([
        'id',
        'filename',
        'state',
        'total_messages',
        'prepared',
        'converted',
        'warnings',
        'last_error',
        'created_at',
        'expires_at',
      ])
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
    const files = tasks.length
      ? await r.db
          .selectFrom('mail_archive_export_files')
          .select(['id', 'export_id', 'filename', 'size_bytes'])
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where(
            'export_id',
            'in',
            tasks.map((t) => t.id),
          )
          .where('kind', '=', 'pst')
          .orderBy('filename')
          .execute()
      : [];
    return tasks.map((t) => ({
      ...t,
      state:
        ['ready', 'failed'].includes(t.state) && t.expires_at <= new Date() ? 'expired' : t.state,
      files: files
        .filter((f) => f.export_id === t.id)
        .map(({ export_id: _parent, ...file }) => {
          void _parent;
          return file;
        }),
    }));
  });
  app.post(
    '/api/mailboxes/:id/archive-exports',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { c, id, box } = await authorize(req.ctx, req.params);
      const body = z
        .object({
          format: z.literal('pst'),
          folder_id: z.uuid().optional(),
          include_deleted: z.boolean().default(false),
        })
        .parse(req.body);
      if (
        body.folder_id &&
        !(await r.db
          .selectFrom('folders')
          .select('id')
          .where('id', '=', body.folder_id)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst())
      )
        throw notFound();
      const cutoff = new Date();
      const task = await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, c.tenantId);
        const existing = await tx
          .selectFrom('mail_archive_exports')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('state', 'in', ['queued', 'staging', 'converting'])
          .executeTakeFirst();
        if (existing) return { ...existing, existing: true };
        const totals = await tx
          .selectFrom('messages')
          .select([
            sql<string>`count(*)::text`.as('messages'),
            sql<string>`coalesce(sum(size_bytes),0)::text`.as('bytes'),
          ])
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('created_at', '<=', cutoff)
          .$if(!body.include_deleted, (q) => q.where('deleted_at', 'is', null))
          .$if(!!body.folder_id, (q) => q.where('folder_id', '=', body.folder_id!))
          .where((eb) =>
            eb.or([
              eb('raw_storage_path', 'is not', null),
              eb('body_text', '!=', ''),
              eb('body_html', 'is not', null),
            ]),
          )
          .executeTakeFirstOrThrow();
        // PST needs seekable temporary files. Admission is checked again during staging/conversion.
        await assertStorageGrowth(
          tx,
          c.tenantId,
          id,
          BigInt(totals.bytes) * 3n + 4n * 1024n * 1024n,
        );
        const filename =
          box.email_address.replace(/[^a-z0-9@._-]/gi, '_').slice(0, 200) +
          '-' +
          cutoff.toISOString().slice(0, 10) +
          '.pst';
        const saved = await tx
          .insertInto('mail_archive_exports')
          .values({
            tenant_id: c.tenantId,
            mailbox_id: id,
            created_by: c.userId,
            filename,
            cutoff_at: cutoff,
            folder_id: body.folder_id ?? null,
            include_deleted: body.include_deleted,
            total_messages: Number(totals.messages),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { ...saved, existing: false };
      });
      if (!task.existing) await queue(task.id);
      reply.code(202);
      return { id: task.id };
    },
  );
  app.post('/api/mailboxes/:id/archive-exports/:taskId/resume', async (req) => {
    const { c, id, taskId } = await authorize(req.ctx, req.params);
    const task = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const active = await tx
        .selectFrom('mail_archive_exports')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('state', 'in', ['queued', 'staging', 'converting'])
        .executeTakeFirst();
      if (active) throw conflict('Já existe uma geração de PST em andamento para esta caixa.');
      return tx
        .updateTable('mail_archive_exports')
        .set({
          state: 'queued',
          last_error: null,
          updated_at: new Date(),
          expires_at: new Date(Date.now() + 86400000),
        })
        .where('id', '=', taskId!)
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('state', '=', 'failed')
        .where('expires_at', '>', new Date())
        .returning('id')
        .executeTakeFirst();
    });
    if (!task)
      throw conflict('Esta exportação não está disponível para retomada. Gere um novo PST.');
    await queue(task.id);
    return { ok: true };
  });
  app.post('/api/mailboxes/:id/archive-exports/:taskId/cancel', async (req) => {
    const { c, id, taskId } = await authorize(req.ctx, req.params);
    const result = await r.db
      .updateTable('mail_archive_exports')
      .set({ state: 'cancelled', last_error: null, updated_at: new Date() })
      .where('id', '=', taskId!)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .where('state', 'not in', ['expired', 'cancelled'])
      .returning('id')
      .executeTakeFirst();
    if (!result) throw notFound();
    await r.queues.maintenance.add('cleanup-uploads', {}).catch(() => undefined);
    return { ok: true };
  });
  app.get('/api/mailboxes/:id/archive-exports/:taskId/files/:fileId', async (req, reply) => {
    const { c, id, taskId, fileId } = await authorize(req.ctx, req.params);
    const file = await r.db
      .selectFrom('mail_archive_export_files as f')
      .innerJoin('mail_archive_exports as e', 'e.id', 'f.export_id')
      .select(['f.filename', 'f.storage_path', 'f.size_bytes'])
      .where('f.id', '=', fileId!)
      .where('f.export_id', '=', taskId!)
      .where('f.tenant_id', '=', c.tenantId)
      .where('f.mailbox_id', '=', id)
      .where('f.kind', '=', 'pst')
      .where('e.state', '=', 'ready')
      .where('e.expires_at', '>', new Date())
      .executeTakeFirst();
    if (!file) throw notFound();
    const storage = new Storage(r.env.STORAGE_DIR, r.db);
    if (!(await storage.inspect(file.storage_path)))
      throw new ApiError(
        404,
        'pst_export_missing',
        'O backup expirou ou foi removido. Gere um novo PST.',
      );
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'mail.pst_downloaded',
      entityType: 'mailbox',
      entityId: id,
      metadata: { export_id: taskId, file_id: fileId },
      ip: c.ip,
    }).catch(() => app.log.warn({ export_id: taskId }, 'Registro do download PST pendente.'));
    const length = Number(file.size_bytes);
    let range: { start: number; end: number } | undefined;
    if (req.headers.range) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (parsed && (parsed[1] || parsed[2])) {
        const start = parsed[1] ? Number(parsed[1]) : Math.max(0, length - Number(parsed[2]));
        const end = parsed[1]
          ? parsed[2]
            ? Math.min(length - 1, Number(parsed[2]))
            : length - 1
          : length - 1;
        if (
          Number.isSafeInteger(start) &&
          Number.isSafeInteger(end) &&
          start >= 0 &&
          start <= end &&
          start < length
        )
          range = { start, end };
      }
      if (!range) {
        reply.code(416).header('Content-Range', `bytes */${length}`);
        return reply.send();
      }
      reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${length}`);
    }
    reply
      .header('Cache-Control', 'no-store')
      .header('Accept-Ranges', 'bytes')
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('Content-Length', range ? String(range.end - range.start + 1) : file.size_bytes)
      .type('application/octet-stream');
    return reply.send(await storage.openReadStream(file.storage_path, range));
  });
}
