import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { Storage, audit, lockStorageTenant, assertStorageGrowth } from '@apmail/db';
import {
  archivePreflightSchema,
  archiveQuotaCheck,
  mailArchiveFormat,
  MAIL_ARCHIVE_MAX_BYTES,
  toBullJobId,
} from '@apmail/shared';
import { requireTenantAdmin, ApiError, notFound, conflict } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';
import { registerMailArchiveExports } from './mail-archive-exports.js';

const taskColumns = [
  'id',
  'filename',
  'format',
  'size_bytes',
  'state',
  'cursor',
  'imported',
  'skipped',
  'last_error',
  'created_at',
  'updated_at',
] as const;
const params = z.object({ id: z.uuid(), taskId: z.uuid().optional() });
export async function archiveAdmission(r: Resources, tenant: string, box: string, bytes: number) {
  const { rows } = await sql<{
    tenant_used: string;
    tenant_limit: string | null;
    box_used: string;
    box_limit: string | null;
  }>`select storage_quota_usage(${tenant}::uuid)::text as tenant_used,storage_quota_usage(${tenant}::uuid,${box}::uuid)::text as box_used,
    (select storage_limit_bytes::text from tenant_storage_limits where tenant_id=${tenant}::uuid) as tenant_limit,
    (select allocated_bytes::text from mailbox_storage_limits where tenant_id=${tenant}::uuid and mailbox_id=${box}::uuid) as box_limit`.execute(
    r.db,
  );
  const row = rows[0]!;
  const tenantQuota = archiveQuotaCheck(
    BigInt(bytes),
    BigInt(row.tenant_used),
    row.tenant_limit === null ? null : BigInt(row.tenant_limit),
  );
  const mailboxQuota = archiveQuotaCheck(
    BigInt(bytes),
    BigInt(row.box_used),
    row.box_limit === null ? null : BigInt(row.box_limit),
  );
  if (!tenantQuota.allowed || !mailboxQuota.allowed)
    throw new ApiError(
      409,
      'archive_quota_exceeded',
      !tenantQuota.allowed
        ? 'O arquivo excede o armazenamento restante da empresa. Amplie a cota ou libere espaço antes de importar.'
        : 'O arquivo excede o armazenamento restante desta caixa. Redistribua a cota antes de importar.',
    );
  return {
    allowed: true,
    near_limit: tenantQuota.near_limit || mailboxQuota.near_limit,
    tenant_remaining_bytes: tenantQuota.remaining_bytes,
    mailbox_remaining_bytes: mailboxQuota.remaining_bytes,
    warning:
      tenantQuota.near_limit || mailboxQuota.near_limit
        ? 'Após receber este arquivo, o uso ficará em pelo menos 90% da cota. A conversão pode precisar de espaço adicional.'
        : null,
  };
}
function validateSignature(format: string, header: Buffer) {
  const ascii = header.toString('latin1');
  const valid =
    format === 'pst' || format === 'ost'
      ? ascii.startsWith('!BDN')
      : format === 'zip'
        ? header.subarray(0, 2).equals(Buffer.from('PK'))
        : format === 'mbox'
          ? ascii.startsWith('From ')
          : format === 'emlx'
            ? /^\d+\r?\n/.test(ascii)
            : /^(?:[\w-]+:[^\r\n]*\r?\n|[ \t]+[^\r\n]*\r?\n)/.test(ascii);
  if (!valid)
    throw new ApiError(
      422,
      'invalid_mail_archive',
      'O conteúdo não corresponde ao formato de e-mail selecionado.',
    );
}
export async function registerMailArchives(app: FastifyInstance, r: Resources) {
  const storage = new Storage(r.env.STORAGE_DIR, r.db);
  const authorize = async (ctx: Parameters<typeof requireTenantAdmin>[0], input: unknown) => {
    const c = requireTenantAdmin(ctx);
    const p = params.parse(input);
    await requireMailboxPerm(c, r.db, p.id, 'read');
    return { c, ...p };
  };
  app.post('/api/mailboxes/:id/archive-imports/preflight', async (req) => {
    const { c, id } = await authorize(req.ctx, req.params);
    const b = archivePreflightSchema.parse(req.body);
    if (!mailArchiveFormat(b.filename))
      throw new ApiError(
        422,
        'unsupported_archive',
        'Use PST, OST, MBOX, EML, EMLX ou ZIP contendo mensagens EML/MBOX/EMLX.',
      );
    return archiveAdmission(r, c.tenantId, id, b.size_bytes);
  });
  app.get('/api/mailboxes/:id/archive-imports', async (req) => {
    const { c, id } = await authorize(req.ctx, req.params);
    return r.db
      .selectFrom('mail_archive_imports')
      .select(taskColumns)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
  });
  app.post('/api/mailboxes/:id/archive-imports', async (req, reply) => {
    const { c, id } = await authorize(req.ctx, req.params);
    const b = archivePreflightSchema.parse(req.body),
      format = mailArchiveFormat(b.filename);
    if (!format) throw new ApiError(422, 'unsupported_archive', 'Formato não suportado.');
    const task = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      await archiveAdmission({ ...r, db: tx }, c.tenantId, id, b.size_bytes);
      await assertStorageGrowth(tx, c.tenantId, id, BigInt(b.size_bytes));
      const row = await tx
        .insertInto('mail_archive_imports')
        .values({
          tenant_id: c.tenantId,
          mailbox_id: id,
          created_by: c.userId,
          filename: b.filename,
          format,
          size_bytes: b.size_bytes,
        })
        .returning(taskColumns)
        .executeTakeFirstOrThrow();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'mail.archive_created',
        entityType: 'mailbox',
        entityId: id,
        metadata: { import_id: row.id, format, bytes: b.size_bytes },
        ip: c.ip,
      });
      return row;
    });
    return reply.code(201).send(task);
  });
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
      done(null, payload),
    );
    scope.post(
      '/api/mailboxes/:id/archive-imports/:taskId/upload',
      { bodyLimit: MAIL_ARCHIVE_MAX_BYTES },
      async (req) => {
        const { c, id, taskId } = await authorize(req.ctx, req.params);
        let key: string | null = null;
        try {
          const task = await r.db.transaction().execute(async (tx) => {
            await lockStorageTenant(tx, c.tenantId);
            const row = await tx
              .selectFrom('mail_archive_imports')
              .selectAll()
              .where('id', '=', taskId!)
              .where('tenant_id', '=', c.tenantId)
              .where('mailbox_id', '=', id)
              .forUpdate()
              .executeTakeFirst();
            if (!row) throw notFound();
            if (row.state !== 'uploading')
              throw conflict('Este upload já foi recebido ou encerrado.');
            const size = Number(row.size_bytes);
            await archiveAdmission({ ...r, db: tx }, c.tenantId, id, size);
            key = `mail-imports/${c.tenantId}/${id}/${row.id}.${row.format}`;
            const body = req.body as Readable;
            let count = 0,
              header = Buffer.alloc(0),
              checked = false;
            async function* bounded() {
              for await (const value of body) {
                const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
                count += chunk.length;
                if (count > size)
                  throw new ApiError(
                    413,
                    'archive_size_mismatch',
                    'O upload excede o tamanho informado.',
                  );
                if (header.length < 512)
                  header = Buffer.concat([header, chunk.subarray(0, 512 - header.length)]);
                if (!checked && header.length >= 64) {
                  validateSignature(row!.format, header);
                  checked = true;
                }
                yield chunk;
              }
              if (count !== size)
                throw new ApiError(
                  422,
                  'archive_size_mismatch',
                  'O upload está incompleto. Selecione o arquivo novamente.',
                );
              validateSignature(row!.format, header);
            }
            await storage.withDatabase(tx).writeFile(key, Readable.from(bounded()));
            return tx
              .updateTable('mail_archive_imports')
              .set({ storage_path: key, state: 'queued', updated_at: new Date() })
              .where('id', '=', row.id)
              .returning(taskColumns)
              .executeTakeFirstOrThrow();
          });
          await r.queues['mail-archive']
            .add(
              'import',
              { import_id: task.id },
              {
                jobId: toBullJobId('archive:' + task.id + ':' + randomUUID()),
                attempts: 3,
                backoff: { type: 'exponential', delay: 10000 },
              },
            )
            .catch(() =>
              app.log.warn(
                { import_id: task.id },
                'Importação aguarda recuperação pelo agendador.',
              ),
            );
          return task;
        } catch (error) {
          if (key) await storage.removeFile(key).catch(() => undefined);
          await r.db
            .updateTable('mail_archive_imports')
            .set({
              state: 'failed',
              last_error: 'Não foi possível receber o arquivo. Refaça a importação.',
              updated_at: new Date(),
            })
            .where('id', '=', taskId!)
            .where('tenant_id', '=', c.tenantId)
            .where('state', '=', 'uploading')
            .execute();
          throw error;
        }
      },
    );
  });
  app.post('/api/mailboxes/:id/archive-imports/:taskId/resume', async (req) => {
    const { c, id, taskId } = await authorize(req.ctx, req.params);
    const task = await r.db
      .updateTable('mail_archive_imports')
      .set({ state: 'queued', last_error: null, updated_at: new Date() })
      .where('id', '=', taskId!)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .where('state', 'in', ['paused', 'failed'])
      .where('storage_path', 'is not', null)
      .returning('id')
      .executeTakeFirst();
    if (!task) throw conflict('A importação não está disponível para retomada.');
    await r.queues['mail-archive'].add(
      'import',
      { import_id: task.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 10000 } },
    );
    return { ok: true };
  });
  app.post('/api/mailboxes/:id/archive-imports/:taskId/cancel', async (req) => {
    const { c, id, taskId } = await authorize(req.ctx, req.params);
    const task = await r.db
      .updateTable('mail_archive_imports')
      .set({ state: 'cancelled', updated_at: new Date() })
      .where('id', '=', taskId!)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .where('state', 'not in', ['completed', 'cancelled'])
      .returning('storage_path')
      .executeTakeFirst();
    if (!task) throw conflict('Esta importação já foi encerrada.');
    // Reader notices cancellation at the next message; removing the source releases its accounted bytes.
    let cleanupPending = false;
    if (task.storage_path)
      await storage.removeFile(task.storage_path).catch(() => {
        cleanupPending = true;
      });
    if (!cleanupPending)
      await r.db
        .updateTable('mail_archive_imports')
        .set({ storage_path: null })
        .where('id', '=', taskId!)
        .where('tenant_id', '=', c.tenantId)
        .execute();
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'mail.archive_cancelled',
      entityType: 'mailbox',
      entityId: id,
      metadata: { import_id: taskId, cleanup_pending: cleanupPending },
      ip: c.ip,
    });
    return { ok: true, cleanup_pending: cleanupPending };
  });
  await registerMailArchiveExports(app, r);
  app.post('/api/mailboxes/:id/archive-purge-deleted', async (req) => {
    const { c, id } = await authorize(req.ctx, req.params);
    z.object({ confirm: z.literal(true) }).parse(req.body);
    let purged = 0,
      blocked = 0;
    const files: string[] = [];
    // Content is removed only from already deleted local/POP/archive messages. Source identities
    // remain as tombstones so POP3 does not download deleted messages again.
    const rows = await r.db
      .selectFrom('messages')
      .select(['id', 'raw_storage_path'])
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .where('source_kind', '!=', 'imap')
      .where('deleted_at', 'is not', null)
      .where('pending_action', '=', false)
      .where('raw_storage_path', 'is not', null)
      .limit(1000)
      .execute();
    for (const row of rows) {
      const paths = await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, c.tenantId);
        const message = await tx
          .selectFrom('messages')
          .select(['id', 'raw_storage_path'])
          .where('id', '=', row.id)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('deleted_at', 'is not', null)
          .where('pending_action', '=', false)
          .forUpdate()
          .executeTakeFirst();
        if (!message?.raw_storage_path) return [];
        const used = await sql<{
          id: string;
        }>`select o.id from outbox o where o.tenant_id=${c.tenantId}::uuid and o.status in ('draft','scheduled','queued','sending','failed') and exists(select 1 from attachments a where a.message_id=${row.id}::uuid and o.attachments @> jsonb_build_array(jsonb_build_object('attachment_id',a.id))) limit 1`.execute(
          tx,
        );
        if (used.rows.length) {
          blocked++;
          return [];
        }
        const attachments = await tx
          .deleteFrom('attachments')
          .where('message_id', '=', row.id)
          .where('tenant_id', '=', c.tenantId)
          .returning('storage_path')
          .execute();
        const list = [message.raw_storage_path, ...attachments.map((a) => a.storage_path)];
        await tx
          .updateTable('messages')
          .set({
            body_text: '',
            body_html: null,
            snippet: '',
            raw_storage_path: null,
            has_attachments: false,
            size_bytes: 0,
          })
          .where('id', '=', row.id)
          .execute();
        await tx
          .updateTable('storage_assets')
          .set({ category: 'mail_purge_pending' })
          .where('storage_key', 'in', list)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .execute();
        purged++;
        return list;
      });
      files.push(...paths);
    }
    let pending = 0;
    for (const key of files)
      await storage.removeFile(key).catch(() => {
        pending++;
      });
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'mail.archive_content_purged',
      entityType: 'mailbox',
      entityId: id,
      metadata: { purged, blocked, pending },
      ip: c.ip,
    }).catch(() => app.log.warn({ mailbox_id: id }, 'Auditoria da limpeza pendente.'));
    r.io.to('mailbox:' + id).emit('threads:changed', { mailbox_id: id, thread_ids: [] });
    return { purged, blocked, pending, batch_limit: 1000 };
  });
}
