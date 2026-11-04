import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { hasAccess, isTenantAdmin, type AccessPermission } from '@apmail/shared';
import {
  Storage,
  assertFilesClean,
  audit,
  htmlToText,
  lockStorageTenant,
  touchThreads,
} from '@apmail/db';
import {
  conflict,
  forbidden,
  notFound,
  requireTenant,
  type RequestContext,
} from '../authz/context.js';
import type { Resources } from './resources.js';

const messageId = z.object({ id: z.uuid() });
const attachmentId = messageId.extend({ attachmentId: z.uuid() });
const policySchema = z.object({ days: z.number().int().min(1).max(3650) });
const filterSchema = z
  .object({
    mailbox_id: z.uuid().optional(),
    user_id: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'O início deve ser anterior ao fim.');

function authorize(ctx: RequestContext | null, permission: AccessPermission) {
  const c = requireTenant(ctx);
  if (
    !isTenantAdmin(c.tenantRole) ||
    !hasAccess({ role: c.tenantRole, access_permissions: c.accessPermissions }, permission)
  )
    throw forbidden();
  return c;
}

export async function registerMailRetention(app: FastifyInstance, r: Resources) {
  const storage = new Storage(r.env.STORAGE_DIR, r.db);
  app.get('/api/mail-retention/policy', async (req) => {
    const c = authorize(req.ctx, 'company.manage');
    const row = await r.db
      .selectFrom('tenants')
      .select('mail_retention_days')
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    return { days: row.mail_retention_days };
  });
  app.patch('/api/mail-retention/policy', async (req) => {
    const c = authorize(req.ctx, 'company.manage');
    const { days } = policySchema.parse(req.body);
    return r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const previous = await tx
        .selectFrom('tenants')
        .select('mail_retention_days')
        .where('id', '=', c.tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('tenants')
        .set({ mail_retention_days: days })
        .where('id', '=', c.tenantId)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'retention.policy_updated',
        entityType: 'tenant',
        entityId: c.tenantId,
        ip: c.ip,
        requestId: req.id,
        metadata: { before_days: previous.mail_retention_days, after_days: days },
      });
      return { days };
    });
  });

  const retained = (tenant: string) =>
    r.db
      .selectFrom('messages as m')
      .innerJoin('mailboxes as b', (join) =>
        join.onRef('b.id', '=', 'm.mailbox_id').onRef('b.tenant_id', '=', 'm.tenant_id'),
      )
      .leftJoin('users as u', 'u.id', 'm.retention_deleted_by')
      .where('m.tenant_id', '=', tenant)
      .where('m.retention_expires_at', 'is not', null);

  app.get('/api/mail-retention/filters', async (req) => {
    const c = authorize(req.ctx, 'retention.manage');
    const base = retained(c.tenantId);
    const [mailboxes, users] = await Promise.all([
      base.select(['b.id', 'b.name', 'b.email_address']).distinct().orderBy('b.name').execute(),
      base
        .select(['u.id', 'u.full_name'])
        .where('u.id', 'is not', null)
        .distinct()
        .orderBy('u.full_name')
        .execute(),
    ]);
    return { mailboxes, users };
  });

  app.get('/api/mail-retention', async (req, reply) => {
    const c = authorize(req.ctx, 'retention.manage');
    const q = filterSchema.parse(req.query);
    const tenant = await r.db
      .selectFrom('tenants')
      .select('timezone')
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    const timezone = tenant.timezone;
    const base = retained(c.tenantId);
    let list = base;
    if (q.mailbox_id) list = list.where('m.mailbox_id', '=', q.mailbox_id);
    if (q.user_id) list = list.where('m.retention_deleted_by', '=', q.user_id);
    if (q.q) list = list.where('m.subject', 'ilike', '%' + q.q.replace(/[\\%_]/g, '\\$&') + '%');
    if (q.from)
      list = list.where(
        'm.deleted_at',
        '>=',
        sql<Date>`${q.from}::date::timestamp at time zone ${timezone}`,
      );
    if (q.to)
      list = list.where(
        'm.deleted_at',
        '<',
        sql<Date>`(${q.to}::date+1)::timestamp at time zone ${timezone}`,
      );
    const [items, total, eligible] = await Promise.all([
      list
        .select([
          'm.id',
          'm.subject',
          'm.deleted_at',
          'm.retention_expires_at',
          'm.pending_action',
          'm.retention_purge_requested_at',
          'm.retention_last_error',
          'm.retention_deleted_by',
          'b.name as mailbox_name',
          'b.email_address as mailbox_email',
          'u.full_name as deleted_by',
        ])
        .orderBy('m.deleted_at', 'desc')
        .orderBy('m.id')
        .limit(25)
        .offset((q.page - 1) * 25)
        .execute(),
      list.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow(),
      base
        .where('m.retention_purge_requested_at', 'is', null)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    ]);
    reply.header('Cache-Control', 'private, no-store');
    return { items, total: Number(total.count), purgeable_count: Number(eligible.count), timezone };
  });

  app.get('/api/mail-retention/:id', async (req, reply) => {
    const c = authorize(req.ctx, 'retention.manage');
    const { id } = messageId.parse(req.params);
    const message = await retained(c.tenantId)
      .where('m.id', '=', id)
      .select([
        'm.id',
        'm.subject',
        'm.body_text',
        'm.body_html',
        'm.from_name',
        'm.from_address',
        'm.to_addresses',
        'm.cc_addresses',
        'm.bcc_addresses',
        'm.message_at',
        sql<boolean>`m.raw_storage_path is not null`.as('has_original'),
      ])
      .executeTakeFirst();
    if (!message) throw notFound();
    const attachments = await r.db
      .selectFrom('attachments')
      .where('tenant_id', '=', c.tenantId)
      .where('message_id', '=', id)
      .select(['id', 'filename', 'content_type', 'size_bytes'])
      .orderBy('created_at')
      .execute();
    const { body_html, ...detail } = message;
    reply.header('Cache-Control', 'private, no-store');
    return { ...detail, body_text: detail.body_text || htmlToText(body_html ?? ''), attachments };
  });

  for (const kind of ['original', 'attachments'] as const) {
    app.get(
      '/api/mail-retention/:id/' + (kind === 'original' ? kind : 'attachments/:attachmentId'),
      async (req, reply) => {
        const c = authorize(req.ctx, 'retention.manage');
        const { id } = messageId.parse(req.params);
        const fileId = kind === 'attachments' ? attachmentId.parse(req.params).attachmentId : null;
        const message = await retained(c.tenantId)
          .where('m.id', '=', id)
          .select('m.raw_storage_path')
          .executeTakeFirst();
        if (!message) throw notFound();
        const file = fileId
          ? await r.db
              .selectFrom('attachments')
              .where('tenant_id', '=', c.tenantId)
              .where('message_id', '=', id)
              .where('id', '=', fileId)
              .select(['filename', 'storage_path'])
              .executeTakeFirst()
          : { filename: 'mensagem.eml', storage_path: message.raw_storage_path };
        if (!file?.storage_path) throw notFound();
        await assertFilesClean(r.db, [file.storage_path], storage);
        const filename = encodeURIComponent(file.filename.replace(/[\r\n]/g, '_')).replace(
          /['()*]/g,
          (char) => '%' + char.charCodeAt(0).toString(16),
        );
        reply
          .header('Content-Disposition', "attachment; filename*=UTF-8''" + filename)
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', "default-src 'none'; sandbox")
          .type('application/octet-stream');
        return reply.send(await storage.openReadStream(file.storage_path));
      },
    );
  }

  app.post('/api/mail-retention/:id/restore', async (req) => {
    const c = authorize(req.ctx, 'retention.manage');
    const { id } = messageId.parse(req.params);
    const message = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const row = await tx
        .selectFrom('messages')
        .select([
          'mailbox_id',
          'thread_id',
          'pending_action',
          'direction',
          'source_kind',
          'retention_purge_requested_at',
        ])
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where('retention_expires_at', 'is not', null)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw notFound();
      if (row.pending_action)
        throw conflict('Aguarde a sincronização da exclusão antes de restaurar.');
      if (row.retention_purge_requested_at)
        throw conflict('A exclusão definitiva já foi confirmada.');
      const destination = await tx
        .selectFrom('folders as f')
        .innerJoin('mailboxes as b', 'b.id', 'f.mailbox_id')
        .select(['f.id', 'f.special_use'])
        .where('f.tenant_id', '=', c.tenantId)
        .where('f.mailbox_id', '=', row.mailbox_id)
        .where('f.deleted_at', 'is', null)
        .where('b.deleted_at', 'is', null)
        .where('f.special_use', 'in', row.direction === 'outbound' ? ['sent', 'inbox'] : ['inbox'])
        .orderBy(sql`(f.special_use='sent')`, 'desc')
        .orderBy('f.special_use_official', 'desc')
        .orderBy('f.id')
        .executeTakeFirst();
      if (!destination) throw conflict('A caixa ou a pasta de recuperação está indisponível.');
      await tx
        .updateTable('messages')
        .set({
          deleted_at: null,
          folder_id: destination.id,
          imap_uid: null,
          ...(row.source_kind === 'imap' ? { source_kind: 'archive', source_key: null } : {}),
          retention_expires_at: null,
          retention_deleted_by: null,
          retention_retry_at: null,
          retention_last_error: null,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      await touchThreads(tx, [row.thread_id], 'manual', c.userId);
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'retention.message_restored',
        entityType: 'retained_message',
        entityId: id,
        ip: c.ip,
        requestId: req.id,
        metadata: { mailbox_id: row.mailbox_id, target_folder_id: destination.id },
      });
      return { ...row, destination: destination.special_use };
    });
    r.io.to('mailbox:' + message.mailbox_id).emit('threads:changed', {
      mailbox_id: message.mailbox_id,
      thread_ids: [message.thread_id],
    });
    r.io.to('tenant:' + c.tenantId).emit('queue-counts:changed', {});
    return { ok: true, destination: message.destination };
  });

  app.post('/api/mail-retention/purge', async (req, reply) => {
    const c = authorize(req.ctx, 'retention.purge');
    const b = z
      .discriminatedUnion('scope', [
        z.object({ scope: z.literal('message'), id: z.uuid(), confirmation: z.literal('EXCLUIR') }),
        z.object({
          scope: z.literal('all'),
          expected_count: z.number().int().positive(),
          confirmation: z.literal('EXCLUIR'),
        }),
      ])
      .parse(req.body);
    const queued = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      let eligible = tx
        .selectFrom('messages')
        .where('tenant_id', '=', c.tenantId)
        .where('retention_expires_at', 'is not', null)
        .where('retention_purge_requested_at', 'is', null);
      if (b.scope === 'message') eligible = eligible.where('id', '=', b.id);
      const count = Number(
        (
          await eligible
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
      );
      if (b.scope === 'message' && !count) throw notFound();
      if (b.scope === 'all' && count !== b.expected_count)
        throw conflict('A quantidade em retenção mudou. Atualize a lista e confirme novamente.');
      await tx
        .updateTable('messages')
        .set({
          retention_purge_requested_at: new Date(),
          retention_purge_requested_by: c.userId,
          retention_retry_at: null,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', 'in', eligible.select('id'))
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'retention.purge_requested',
        entityType: b.scope === 'message' ? 'retained_message' : 'tenant',
        entityId: b.scope === 'message' ? b.id : c.tenantId,
        ip: c.ip,
        requestId: req.id,
        metadata: { count, scope: b.scope },
      });
      return count;
    });
    await r.queues.maintenance
      .add(
        'purge-retained-mail',
        {},
        {
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch(() => app.log.warn('Limpeza em retenção será retomada pelo agendador.'));
    return reply.code(202).send({ queued });
  });
}
