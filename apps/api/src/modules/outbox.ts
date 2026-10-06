import { isTenantAdmin } from '@apmail/shared';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import {
  Storage,
  asJson,
  sanitizeEmailHtml,
  touchThreads,
  resolveOutboxAttachments,
  prepareSignature,
  outboxJobId,
  sendJobOptions,
  audit,
  type OutboxRow,
} from '@apmail/db';
import {
  outboxSchema,
  signatureSchema,
  validateSchedule,
  can,
  type OutboxInput,
  type Address,
} from '@apmail/shared';
import {
  requireTenant,
  notFound,
  forbidden,
  conflict,
  ApiError,
  type RequestContext,
} from '../authz/context.js';
import { requireMailboxPerm, getMailboxRole } from '../authz/guards.js';
import { readableFolders, folderPredicate, requireFolder } from '../authz/folders.js';
import { requireThread } from './mail.js';
import type { Resources } from './resources.js';
const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
const validation = (message: string) => new ApiError(400, 'validation_error', message);
export async function registerOutboxRoutes(app: FastifyInstance, r: Resources) {
  const storage = new Storage(r.env.STORAGE_DIR, r.db);
  const owned = async (ctx: RequestContext | null, id: string) => {
    const c = requireTenant(ctx);
    const row = await r.db
      .selectFrom('outbox')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .executeTakeFirst();
    if (!row) throw notFound();
    return { c, row };
  };
  const flags = async (c: RequestContext, row: OutboxRow) => {
    const role = await getMailboxRole(c, r.db, row.mailbox_id);
    return {
      can_cancel:
        (row.created_by === c.userId && ['queued', 'scheduled'].includes(row.status)) ||
        (row.status === 'scheduled' && !!role && can(role, 'cancel_any')),
      can_edit:
        row.created_by === c.userId &&
        ['draft', 'queued', 'scheduled'].includes(row.status) &&
        !!role &&
        can(role, 'send'),
    };
  };
  const changed = (row: OutboxRow) => {
    // Rascunhos são privados, inclusive no canal de atualização.
    r.io
      .to(row.status === 'draft' ? `user:${row.created_by}` : `mailbox:${row.mailbox_id}`)
      .emit('outbox:changed', { mailbox_id: row.mailbox_id, outbox_id: row.id });
    if (row.thread_id) {
      r.io
        .to(`thread:${row.thread_id}`)
        .emit('thread:messages-changed', { thread_id: row.thread_id });
      r.io
        .to(`mailbox:${row.mailbox_id}`)
        .emit('queue-counts:changed', { mailbox_id: row.mailbox_id });
    }
  };
  const validateRefs = async (c: ReturnType<typeof requireTenant>, body: OutboxInput) => {
    await requireMailboxPerm(c, r.db, body.mailbox_id, 'send');
    const scope = await readableFolders(c, r.db, body.mailbox_id);
    if (body.thread_id) {
      const t = await r.db
        .selectFrom('threads')
        .select('id')
        .where('id', '=', body.thread_id)
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', body.mailbox_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!t) throw notFound();
      await requireThread(c, r, body.thread_id);
    }
    if (body.reply_to_message_id) {
      const m = await r.db
        .selectFrom('messages')
        .select(['thread_id', 'folder_id'])
        .where('id', '=', body.reply_to_message_id)
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', body.mailbox_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!m || m.thread_id !== body.thread_id) throw notFound();
      await requireFolder(c, r.db, body.mailbox_id, m.folder_id);
    }
    if (
      ['reply', 'reply_all'].includes(body.kind) &&
      (!body.reply_to_message_id || !body.thread_id)
    )
      throw validation('Selecione a mensagem respondida.');
    if (body.signature_id) {
      const s = await r.db
        .selectFrom('signatures')
        .select('mailbox_id')
        .where('id', '=', body.signature_id)
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!s || (s.mailbox_id && s.mailbox_id !== body.mailbox_id)) throw notFound();
    }
    for (const ref of body.attachments) {
      if (ref.source !== 'message_attachment') continue;
      const file = await r.db
        .selectFrom('attachments as a')
        .innerJoin('messages as m', 'm.id', 'a.message_id')
        .select('a.id')
        .where('a.id', '=', ref.attachment_id)
        .where('a.tenant_id', '=', c.tenantId)
        .where('a.mailbox_id', '=', body.mailbox_id)
        .where('m.deleted_at', 'is', null)
        .where(folderPredicate(scope))
        .executeTakeFirst();
      if (!file) throw notFound();
    }
    try {
      const files = await resolveOutboxAttachments(r.db, {
        attachments: body.attachments,
        tenant_id: c.tenantId,
        mailbox_id: body.mailbox_id,
        created_by: c.userId,
      });
      body.body_html = (
        await prepareSignature(
          r.db,
          {
            ...body,
            tenant_id: c.tenantId,
            created_by: c.userId,
          },
          files.flatMap((file) => (file.content_id ? [file.content_id] : [])),
        )
      ).bodyHtml;
    } catch (e) {
      throw validation((e as Error).message);
    }
  };
  const values = (body: OutboxInput) => ({
    ...body,
    thread_id: body.thread_id ?? null,
    reply_to_message_id: body.reply_to_message_id ?? null,
    signature_id: body.signature_id ?? null,
    body_html: sanitizeEmailHtml(body.body_html, '', false),
    to_addresses: asJson(body.to_addresses),
    cc_addresses: asJson(body.cc_addresses),
    bcc_addresses: asJson(body.bcc_addresses),
    attachments: asJson(body.attachments),
  });
  const clearUploads = async (row: OutboxRow) => {
    const files = await r.db
      .selectFrom('uploads')
      .select(['id', 'storage_path'])
      .where('user_id', '=', row.created_by)
      .where('tenant_id', '=', row.tenant_id)
      .where('consumed_at', 'is', null)
      .where(
        sql<boolean>`${sql.ref('id')} in (select (a->>'upload_id')::uuid from jsonb_array_elements(${asJson(row.attachments)}) a where a->>'source'='upload')`,
      )
      .where(
        sql<boolean>`not exists(select 1 from outbox o where o.attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',uploads.id)))`,
      )
      .execute();
    for (const file of files) {
      await storage.removeFile(file.storage_path);
      await r.db.deleteFrom('uploads').where('id', '=', file.id).execute();
    }
  };
  app.post('/api/uploads', async (req, reply) => {
    const c = requireTenant(req.ctx),
      file = await req.file();
    const { mailbox_id } = z.object({ mailbox_id: z.uuid().optional() }).parse(req.query);
    if (mailbox_id) await requireMailboxPerm(c, r.db, mailbox_id, 'send');
    else {
      const configured = await sql<{
        cap: string | null;
      }>`select storage_limit_bytes::text as cap from tenant_storage_limits where tenant_id=${c.tenantId}::uuid`.execute(
        r.db,
      );
      if (configured.rows[0]?.cap !== null && configured.rows[0]?.cap !== undefined)
        throw validation('Selecione a caixa de envio antes de anexar um arquivo.');
    }
    if (!file) throw validation('Escolha um arquivo.');
    const filename = file.filename.replace(/[/\\\0\r\n]/g, '_').slice(0, 255) || 'anexo';
    if (/\.(exe|bat|cmd|com|scr|js|vbs|msi|ps1|sh|jar|html|svg)$/i.test(filename))
      throw validation('Este tipo de arquivo não é permitido.');
    const buffer = await file.toBuffer();
    const detected = await fileTypeFromBuffer(buffer);
    if (
      detected &&
      /executable|x-msdownload|x-dosexec|x-sharedlib|x-mach-binary/i.test(detected.mime)
    )
      throw validation('Este tipo de arquivo não é permitido.');
    const id = randomUUID(),
      path = mailbox_id
        ? `uploads/${c.tenantId}/${mailbox_id}/${c.userId}/${id}`
        : `uploads/${c.tenantId}/${c.userId}/${id}`;
    await storage.writeFile(path, buffer);
    try {
      return reply.code(201).send(
        await r.db
          .insertInto('uploads')
          .values({
            id,
            tenant_id: c.tenantId,
            mailbox_id: mailbox_id ?? null,
            user_id: c.userId,
            filename,
            content_type: detected?.mime ?? 'application/octet-stream',
            size_bytes: buffer.length,
            storage_path: path,
          })
          .returning(['id', 'filename', 'content_type', 'size_bytes'])
          .executeTakeFirstOrThrow(),
      );
    } catch (e) {
      await storage.removeFile(path);
      throw e;
    }
  });
  app.delete('/api/uploads/:id', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params);
    const row = await r.db
      .selectFrom('uploads')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!row) throw notFound();
    if (row.consumed_at) throw conflict('Este anexo já foi enviado.');
    const referenced = await r.db
      .selectFrom('outbox')
      .select('id')
      .where('tenant_id', '=', c.tenantId)
      .where('status', 'in', ['queued', 'scheduled', 'sending'])
      .where(sql<boolean>`attachments @> ${asJson([{ source: 'upload', upload_id: id }])}`)
      .executeTakeFirst();
    if (referenced) throw conflict('Este anexo está em um envio em curso.');
    await storage.removeFile(row.storage_path);
    await r.db.deleteFrom('uploads').where('id', '=', id).execute();
    return { ok: true };
  });
  app.get('/api/uploads/:id/image', async (req, reply) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params);
    const file = await r.db
      .selectFrom('uploads')
      .select(['storage_path', 'content_type'])
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('consumed_at', 'is', null)
      .executeTakeFirst();
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.content_type))
      throw notFound();
    return reply
      .type(file.content_type)
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await storage.openReadStream(file.storage_path));
  });
  app.post('/api/outbox', async (req, reply) => {
    const c = requireTenant(req.ctx),
      body = outboxSchema.parse(req.body);
    await validateRefs(c, body);
    const row = await r.db
      .insertInto('outbox')
      .values({ ...values(body), tenant_id: c.tenantId, created_by: c.userId })
      .returningAll()
      .executeTakeFirstOrThrow();
    changed(row);
    return reply.code(201).send({ ...row, ...(await flags(c, row)) });
  });
  app.get('/api/outbox/:id', async (req) => {
    const { c, row } = await owned(req.ctx, idOf(req.params));
    if (row.created_by !== c.userId) {
      if (row.status === 'draft') throw notFound();
      await requireMailboxPerm(c, r.db, row.mailbox_id, 'read');
      const scope = await readableFolders(c, r.db, row.mailbox_id);
      if (scope !== null) {
        if (!row.thread_id) throw notFound();
        await requireThread(c, r, row.thread_id);
      }
    }
    const attachment_metadata = await resolveOutboxAttachments(r.db, row)
      .then((files) =>
        files.map(({ id, filename, content_type, size_bytes, upload_id }) => ({
          id,
          filename,
          content_type,
          size_bytes,
          source: upload_id ? 'upload' : 'message_attachment',
        })),
      )
      .catch(() => []);
    return { ...row, ...(await flags(c, row)), attachment_metadata };
  });
  app.patch('/api/outbox/:id', async (req) => {
    const { c, row } = await owned(req.ctx, idOf(req.params));
    if (row.created_by !== c.userId) throw forbidden();
    if (row.status !== 'draft') throw conflict('Somente rascunhos podem ser editados.');
    const body = outboxSchema.parse({ ...row, ...(req.body as object) });
    await validateRefs(c, body);
    const updated = await r.db
      .updateTable('outbox')
      .set(values(body))
      .where('id', '=', row.id)
      .where('status', '=', 'draft')
      .returningAll()
      .executeTakeFirst();
    if (!updated) throw conflict('Este envio mudou. Atualize a página.');
    changed(updated);
    return { ...updated, ...(await flags(c, updated)) };
  });
  app.delete('/api/outbox/:id', async (req) => {
    const { c, row } = await owned(req.ctx, idOf(req.params));
    if (row.created_by !== c.userId) throw forbidden();
    if (row.status !== 'draft') throw conflict('Somente rascunhos podem ser excluídos.');
    const removed = await r.db
      .deleteFrom('outbox')
      .where('id', '=', row.id)
      .where('status', '=', 'draft')
      .returning('id')
      .executeTakeFirst();
    if (!removed) throw conflict('Este envio mudou. Atualize a página.');
    await clearUploads(row);
    changed(row);
    return { ok: true };
  });
  app.get('/api/outbox', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          tab: z.enum(['drafts', 'scheduled', 'queued', 'failed']).default('scheduled'),
          mailbox_id: z.uuid().optional(),
          page: z.coerce.number().int().min(1).default(1),
          page_size: z.coerce
            .number()
            .refine((n) => [10, 20, 30, 50, 100].includes(n))
            .default(10),
          search: z.string().max(200).optional(),
        })
        .parse(req.query);
    const visible = await r.db
      .selectFrom('mailboxes')
      .leftJoin('mailbox_members', (join) =>
        join
          .onRef('mailbox_members.mailbox_id', '=', 'mailboxes.id')
          .on('mailbox_members.user_id', '=', c.userId),
      )
      .select('mailboxes.id')
      .where('mailboxes.tenant_id', '=', c.tenantId)
      .where('mailboxes.deleted_at', 'is', null)
      .$if(!isTenantAdmin(c.tenantRole), (query) =>
        query.where('mailbox_members.user_id', '=', c.userId),
      )
      .execute();
    let query = r.db
      .selectFrom('outbox as o')
      .innerJoin('mailboxes as b', 'b.id', 'o.mailbox_id')
      .innerJoin('users as u', 'u.id', 'o.created_by')
      .where('o.tenant_id', '=', c.tenantId)
      .where(
        'o.mailbox_id',
        'in',
        visible.map((b) => b.id),
      )
      .where(
        'o.status',
        'in',
        q.tab === 'drafts' ? ['draft'] : q.tab === 'queued' ? ['queued', 'sending'] : [q.tab],
      );
    if (q.tab === 'drafts') query = query.where('o.created_by', '=', c.userId);
    const boxPredicates = [];
    for (const box of visible) {
      const scope = await readableFolders(c, r.db, box.id);
      boxPredicates.push(
        scope === null
          ? sql`o.mailbox_id=${box.id}`
          : sql`(o.mailbox_id=${box.id} and (o.created_by=${c.userId} or exists(select 1 from messages m where m.tenant_id=${c.tenantId} and m.thread_id=o.thread_id and m.deleted_at is null and ${folderPredicate(scope)})))`,
      );
    }
    query = query.where(
      boxPredicates.length
        ? sql<boolean>`(${sql.join(boxPredicates, sql` or `)})`
        : sql<boolean>`false`,
    );
    if (q.mailbox_id) query = query.where('o.mailbox_id', '=', q.mailbox_id);
    if (q.search) query = query.where('o.subject', 'ilike', `%${q.search}%`);
    const total = Number(
      (await query.select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())?.n ?? 0,
    );
    const rows = await query
      .selectAll('o')
      .select(['b.name as mailbox_name', 'u.full_name as created_by_name'])
      .orderBy('o.updated_at', 'desc')
      .orderBy('o.id', 'asc')
      .limit(q.page_size)
      .offset((q.page - 1) * q.page_size)
      .execute();
    return {
      items: await Promise.all(
        rows.map(async (row) => ({
          ...row,
          mailbox: { id: row.mailbox_id, name: row.mailbox_name },
          created_by: { id: row.created_by, full_name: row.created_by_name },
          ...(await flags(c, row)),
        })),
      ),
      total,
      page: q.page,
      pageSize: q.page_size,
    };
  });
  for (const action of ['submit', 'cancel', 'send-now', 'retry'] as const)
    app.post(`/api/outbox/:id/${action}`, async (req) => {
      const { c, row } = await owned(req.ctx, idOf(req.params));
      const own = row.created_by === c.userId;
      if (action === 'cancel') {
        if (!own) {
          await requireMailboxPerm(c, r.db, row.mailbox_id, 'cancel_any');
          if (row.status !== 'scheduled') throw forbidden();
        }
        if (!['queued', 'scheduled'].includes(row.status))
          throw conflict('O envio já começou ou não pode ser cancelado.');
        const result = await r.db.transaction().execute(async (tx) => {
          const updated = await tx
            .updateTable('outbox')
            .set({
              status: own ? 'draft' : 'canceled',
              job_id: null,
              send_after: null,
              scheduled_at: null,
            })
            .where('id', '=', row.id)
            .where('status', 'in', ['queued', 'scheduled'])
            .where('job_id', '=', row.job_id)
            .returningAll()
            .executeTakeFirst();
          if (!updated) throw conflict('O envio já começou.');
          if (row.thread_id) await touchThreads(tx, [row.thread_id], 'schedule', c.userId);
          await audit(tx, {
            tenantId: c.tenantId,
            actorId: c.userId,
            action: 'outbox.canceled',
            entityType: 'outbox',
            entityId: row.id,
            ip: c.ip,
          });
          return updated;
        });
        if (row.job_id) await r.queues['outbox-send'].remove(row.job_id).catch(() => undefined);
        changed(result);
        return result;
      }
      if (!own) throw forbidden();
      await requireMailboxPerm(c, r.db, row.mailbox_id, 'send');
      const expected =
        action === 'submit' ? 'draft' : action === 'send-now' ? 'scheduled' : 'failed';
      if (row.status !== expected) throw conflict('Este envio não está disponível para esta ação.');
      const parsed = outboxSchema.parse(row);
      await validateRefs(c, parsed);
      const box = await r.db
        .selectFrom('mailboxes')
        .select('status')
        .where('id', '=', row.mailbox_id)
        .executeTakeFirstOrThrow();
      if (box.status !== 'active') throw conflict('A caixa precisa estar conectada para enviar.');
      const addresses = [...parsed.to_addresses, ...parsed.cc_addresses, ...parsed.bcc_addresses];
      if (!addresses.length) throw validation('Informe ao menos um destinatário válido.');
      if (addresses.length > 100) throw validation('Use no máximo 100 destinatários por envio.');
      const files = await resolveOutboxAttachments(r.db, row),
        tenant = await r.db
          .selectFrom('tenants')
          .select('settings')
          .where('id', '=', c.tenantId)
          .executeTakeFirstOrThrow();
      const max = Number(
        (tenant.settings as { max_attachment_mb?: number }).max_attachment_mb ?? 25,
      );
      if (files.reduce((n, f) => n + f.size_bytes, 0) > max * 1024 * 1024)
        throw validation(`Os anexos excedem o limite de ${max} MB.`);
      let scheduled: Date | null = null;
      if (action === 'submit') {
        const body = z.object({ scheduled_at: z.iso.datetime().optional() }).parse(req.body ?? {});
        if (body.scheduled_at)
          try {
            scheduled = validateSchedule(body.scheduled_at);
          } catch (e) {
            throw validation((e as Error).message);
          }
      }
      const sendAfter = scheduled ?? new Date(Date.now() + (action === 'submit' ? 10000 : 0));
      const updated = await r.db.transaction().execute(async (tx) => {
        const result = await tx
          .updateTable('outbox')
          .set({
            status: scheduled ? 'scheduled' : 'queued',
            scheduled_at: scheduled,
            send_after: sendAfter,
            submit_count: sql`submit_count+1`,
            attempts: action === 'retry' ? 0 : row.attempts,
            last_error: null,
            job_id: outboxJobId(row.id, row.submit_count + 1),
          })
          .where('id', '=', row.id)
          .where('status', '=', expected)
          .where('submit_count', '=', row.submit_count)
          .returningAll()
          .executeTakeFirst();
        if (!result) throw conflict('Este envio já foi alterado.');
        if (row.thread_id) await touchThreads(tx, [row.thread_id], 'schedule', c.userId);
        return result;
      });
      if (row.job_id) await r.queues['outbox-send'].remove(row.job_id).catch(() => undefined);
      // O sweep recupera a publicação se houver queda do Redis após o commit.
      await r.queues['outbox-send']
        .add('send', { outbox_id: row.id }, sendJobOptions(updated))
        .catch(() => app.log.warn('Envio persistido; aguardando recuperação da fila.'));
      changed(updated);
      return updated;
    });
  app.get('/api/mailboxes/:id/address-suggestions', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params);
    await requireMailboxPerm(c, r.db, id, 'read');
    const scope = await readableFolders(c, r.db, id);
    const { q } = z.object({ q: z.string().trim().max(100).default('') }).parse(req.query);
    if (!q) return [];
    const result =
      await sql<Address>`select address,coalesce((array_agg(name order by message_at desc))[1],'') as name from (select m.from_address as address,m.from_name as name,m.message_at from messages m where m.tenant_id=${c.tenantId} and m.mailbox_id=${id} and m.deleted_at is null and ${folderPredicate(scope)} union all select a->>'address',a->>'name',m.message_at from messages m cross join lateral jsonb_array_elements(m.to_addresses||m.cc_addresses) a where m.tenant_id=${c.tenantId} and m.mailbox_id=${id} and m.deleted_at is null and ${folderPredicate(scope)}) contacts where unaccent(address) ilike unaccent(${'%' + q + '%'}) or unaccent(name) ilike unaccent(${'%' + q + '%'}) group by address order by max(message_at) desc,address limit 8`.execute(
        r.db,
      );
    return result.rows;
  });
  app.get('/api/signatures', async (req) => {
    const c = requireTenant(req.ctx);
    return r.db
      .selectFrom('signatures')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
  });
  for (const method of ['POST', 'PATCH'] as const)
    app.route({
      method,
      url: method === 'POST' ? '/api/signatures' : '/api/signatures/:id',
      handler: async (req, reply) => {
        const c = requireTenant(req.ctx),
          id = method === 'PATCH' ? idOf(req.params) : randomUUID();
        const old =
          method === 'PATCH'
            ? await r.db
                .selectFrom('signatures')
                .selectAll()
                .where('id', '=', id)
                .where('tenant_id', '=', c.tenantId)
                .where('user_id', '=', c.userId)
                .where('deleted_at', 'is', null)
                .executeTakeFirst()
            : null;
        if (method === 'PATCH' && !old) throw notFound();
        const body = signatureSchema.parse({ ...old, ...(req.body as object) });
        if (body.mailbox_id) await requireMailboxPerm(c, r.db, body.mailbox_id, 'read');
        const row = await r.db.transaction().execute(async (tx) => {
          // Serializa a escolha do padrão mesmo quando ainda não existe nenhuma assinatura.
          await tx
            .selectFrom('users')
            .select('id')
            .where('id', '=', c.userId)
            .forUpdate()
            .execute();
          if (body.is_default)
            await tx
              .updateTable('signatures')
              .set({ is_default: false })
              .where('tenant_id', '=', c.tenantId)
              .where('user_id', '=', c.userId)
              .where('mailbox_id', body.mailbox_id ? '=' : 'is', body.mailbox_id)
              .execute();
          const values = { ...body, body_html: sanitizeEmailHtml(body.body_html, '', false) };
          return method === 'POST'
            ? tx
                .insertInto('signatures')
                .values({ ...values, id, tenant_id: c.tenantId, user_id: c.userId })
                .returningAll()
                .executeTakeFirstOrThrow()
            : tx
                .updateTable('signatures')
                .set(values)
                .where('id', '=', id)
                .returningAll()
                .executeTakeFirstOrThrow();
        });
        return reply.code(method === 'POST' ? 201 : 200).send(row);
      },
    });
  app.delete('/api/signatures/:id', async (req) => {
    const c = requireTenant(req.ctx),
      row = await r.db
        .updateTable('signatures')
        .set({ deleted_at: new Date(), is_default: false })
        .where('id', '=', idOf(req.params))
        .where('user_id', '=', c.userId)
        .where('tenant_id', '=', c.tenantId)
        .where('deleted_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
    if (!row) throw notFound();
    return { ok: true };
  });
}
