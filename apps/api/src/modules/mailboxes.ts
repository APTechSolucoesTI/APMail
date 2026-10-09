import { isTenantAdmin } from '@apmail/shared';
import { MAILBOX_PERMS, can, canDelegate } from '@apmail/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { mailboxSchema, mailboxRoleSchema } from '@apmail/shared';
import {
  audit,
  auditChanges,
  writeMailboxCredential,
  readMailboxCredential,
  assertMailboxSlot,
  ensureLocalFolders,
  lockStorageTenant,
} from '@apmail/db';
import { assertMailboxConnection, connectionSchema } from '../lib/mailbox-probe.js';
import {
  requireTenant,
  requireTenantAdmin,
  conflict,
  type RequestContext,
} from '../authz/context.js';
import { getMailboxRole, requireMailboxPerm } from '../authz/guards.js';
import { requireMember, setMailboxMember } from './tenants.js';
import type { Resources } from './resources.js';
// Lista explícita: nenhuma query deste módulo lê mailbox_credentials.
const publicColumns = [
  'receiving_protocol',
  'id',
  'tenant_id',
  'name',
  'email_address',
  'aliases',
  'from_name_template',
  'append_sent_copy',
  'sync_since',
  'history_classify_days',
  'import_started_at',
  'status',
  'last_error',
  'last_synced_at',
  'created_at',
  'updated_at',
] as const;
const serverColumns = [
  'imap_host',
  'imap_port',
  'imap_secure',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'username',
] as const;
async function details(ctx: RequestContext, r: Resources, id: string) {
  const c = requireTenant(ctx);
  const role = await requireMailboxPerm(c, r.db, id, 'read');
  let q = r.db
    .selectFrom('mailboxes')
    .select(publicColumns)
    .where('tenant_id', '=', c.tenantId)
    .where('id', '=', id);
  if (isTenantAdmin(c.tenantRole)) q = q.select(serverColumns);
  const row = await q.executeTakeFirstOrThrow();
  return {
    ...row,
    last_error: !isTenantAdmin(c.tenantRole) ? null : row.last_error,
    role,
    permissions: MAILBOX_PERMS.filter(
      (p) =>
        (row.receiving_protocol !== 'local' || p !== 'send') &&
        (can(role, p) || canDelegate(c.tenantRole, c.capabilities, p)),
    ),
  };
}
export async function registerMailboxRoutes(app: FastifyInstance, r: Resources) {
  app.post(
    '/api/mailboxes/test-connection',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      requireTenantAdmin(req.ctx);
      return assertMailboxConnection(r.env, connectionSchema.parse(req.body));
    },
  );
  app.get('/api/mailboxes', async (req) => {
    const c = requireTenant(req.ctx);
    const boxes = await r.db
      .selectFrom('mailboxes')
      .select(publicColumns)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
    const result = [];
    for (const box of boxes) {
      const role = await getMailboxRole(c, r.db, box.id);
      if (role)
        result.push({
          ...box,
          last_error: !isTenantAdmin(c.tenantRole) ? null : box.last_error,
          role,
          permissions: MAILBOX_PERMS.filter(
            (p) =>
              (box.receiving_protocol !== 'local' || p !== 'send') &&
              (can(role, p) || canDelegate(c.tenantRole, c.capabilities, p)),
          ),
        });
    }
    return result;
  });
  app.get('/api/mailboxes/:id', async (req) =>
    details(requireTenant(req.ctx), r, z.object({ id: z.uuid() }).parse(req.params).id),
  );
  app.post('/api/mailboxes', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx);
    const input = req.body as Record<string, unknown>;
    const b = mailboxSchema.parse(
      input?.receiving_protocol === 'local'
        ? {
            ...input,
            imap_host: 'local',
            imap_port: 993,
            imap_secure: true,
            smtp_host: 'local',
            smtp_port: 465,
            smtp_secure: true,
            username: input.email_address,
            password: crypto.randomUUID(),
            append_sent_copy: false,
          }
        : input,
    );
    for (const m of b.members) await requireMember(c, r, m.user_id);
    await assertMailboxSlot(r.db, c.tenantId);
    if (b.receiving_protocol !== 'local') await assertMailboxConnection(r.env, b);
    const { password, members, sync_days, ...data } = b;
    const box = await r.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('mailboxes')
        .values({
          ...data,
          tenant_id: c.tenantId,
          created_by: c.userId,
          ...(data.receiving_protocol === 'local' ? { status: 'active' as const } : {}),
          sync_since: new Date(Date.now() - sync_days * 86400000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (data.receiving_protocol !== 'local')
        await writeMailboxCredential(
          tx,
          c.tenantId,
          row.id,
          password,
          r.env.CREDENTIALS_ENCRYPTION_KEY,
        );
      if (data.receiving_protocol !== 'imap') await ensureLocalFolders(tx, c.tenantId, row.id);
      for (const m of members)
        await tx
          .insertInto('mailbox_members')
          .values({ ...m, tenant_id: c.tenantId, mailbox_id: row.id })
          .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'mailbox.created',
        entityType: 'mailbox',
        entityId: row.id,
        metadata: { name: data.name, email_address: data.email_address },
        ip: c.ip,
      });
      return row;
    });
    if (data.receiving_protocol !== 'local')
      await r.queues['mailbox-connection'].add('connect', { mailbox_id: box.id });
    r.io.to('tenant:' + c.tenantId).emit('mailboxes:changed', {});
    return reply.code(201).send(await details(c, r, box.id));
  });
  app.get('/api/mailbox-deletions', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    return r.db
      .selectFrom('mailbox_purge_requests as p')
      .innerJoin('mailboxes as b', 'b.id', 'p.mailbox_id')
      .select([
        'p.mailbox_id',
        'b.email_address',
        'p.state',
        'p.last_error',
        'p.created_at',
        'p.updated_at',
      ])
      .where('p.tenant_id', '=', c.tenantId)
      .where('p.state', '!=', 'completed')
      .orderBy('p.created_at', 'desc')
      .limit(100)
      .execute();
  });
  app.delete('/api/mailboxes/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ confirm: z.literal(true), confirmed_email: z.email() }).parse(req.body);
    await requireMailboxPerm(c, r.db, id, 'read');
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const box = await tx
        .selectFrom('mailboxes')
        .select(['id', 'email_address'])
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (body.confirmed_email.toLowerCase() !== box.email_address.toLowerCase())
        throw conflict('Digite exatamente o endereço da caixa para confirmar a exclusão.');
      const deliveries = await tx
        .selectFrom('outbox')
        .select(['id', 'status'])
        .where('mailbox_id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .forUpdate()
        .execute();
      if (deliveries.some((delivery) => delivery.status === 'sending'))
        throw conflict('Há um e-mail sendo enviado. Aguarde a conclusão antes de excluir a caixa.');
      const shared = (
        await sql<{
          used: boolean;
        }>`select exists(select 1 from outbox o where o.tenant_id=${c.tenantId}::uuid and o.mailbox_id<>${id}::uuid and o.status in ('draft','queued','scheduled','sending','failed') and (exists(select 1 from attachments a where a.mailbox_id=${id}::uuid and o.attachments @> jsonb_build_array(jsonb_build_object('source','message_attachment','attachment_id',a.id::text))) or exists(select 1 from uploads u where u.mailbox_id=${id}::uuid and o.attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',u.id::text))))) as used`.execute(
          tx,
        )
      ).rows[0]!.used;
      if (shared)
        throw conflict(
          'Anexos desta caixa estão em uso em envios de outra caixa. Remova esses anexos ou conclua os envios antes de excluir.',
        );
      await tx
        .updateTable('outbox')
        .set({ status: 'canceled', job_id: null })
        .where('mailbox_id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .where('status', 'in', ['queued', 'scheduled'])
        .execute();
      await tx
        .updateTable('mailboxes')
        .set({ status: 'disabled', deleted_at: new Date() })
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .execute();
      await tx
        .updateTable('mail_archive_imports')
        .set({ state: 'cancelled', updated_at: new Date() })
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('state', 'not in', ['completed', 'cancelled'])
        .execute();
      await tx
        .deleteFrom('mailbox_credentials')
        .where('mailbox_id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .execute();
      await tx
        .insertInto('mailbox_purge_requests')
        .values({ mailbox_id: id, tenant_id: c.tenantId, requested_by: c.userId })
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'mailbox.deleted',
        entityType: 'mailbox',
        entityId: id,
        metadata: { email_address: box.email_address, permanent: true },
        ip: c.ip,
      });
    });
    await r.queues['mailbox-sync'].removeJobScheduler('sync:' + id).catch(() => undefined);
    await r.queues.maintenance
      .add('purge-mailboxes', {})
      .catch(() => app.log.warn('Exclusão será retomada pelo agendador.'));
    r.io.in('mailbox:' + id).socketsLeave('mailbox:' + id);
    r.io.to('tenant:' + c.tenantId).emit('mailboxes:changed', {});
    return { ok: true, cleanup_pending: true };
  });
  app.patch('/api/mailboxes/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await requireMailboxPerm(c, r.db, id, 'read');
    const b = mailboxSchema
      .partial()
      .omit({ members: true, receiving_protocol: true })
      .parse(req.body);
    const { password, sync_days, ...data } = b;
    const previous = await r.db
      .selectFrom('mailboxes')
      .select([...publicColumns, ...serverColumns])
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const changed =
      !!password ||
      [
        'imap_host',
        'imap_port',
        'imap_secure',
        'smtp_host',
        'smtp_port',
        'smtp_secure',
        'username',
      ].some((k) => k in b);
    if (changed && previous.receiving_protocol !== 'local')
      await assertMailboxConnection(r.env, {
        ...previous,
        ...b,
        password:
          password ??
          (await readMailboxCredential(r.db, c.tenantId, id, r.env.CREDENTIALS_ENCRYPTION_KEY)),
      });
    await r.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('mailboxes')
        .set({
          ...data,
          ...(sync_days ? { sync_since: new Date(Date.now() - sync_days * 86400000) } : {}),
          ...(changed && previous.receiving_protocol !== 'local'
            ? { status: 'pending' as const, last_error: null }
            : {}),
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      if (password)
        await writeMailboxCredential(
          tx,
          c.tenantId,
          id,
          password,
          r.env.CREDENTIALS_ENCRYPTION_KEY,
        );
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'mailbox.updated',
        entityType: 'mailbox',
        entityId: id,
        metadata: auditChanges(previous, data),
        ip: c.ip,
      });
      if (password)
        await audit(tx, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'mailbox.credentials_updated',
          entityType: 'mailbox',
          entityId: id,
          ip: c.ip,
        });
    });
    if (changed && previous.receiving_protocol !== 'local')
      await r.queues['mailbox-connection'].add('connect', { mailbox_id: id });
    r.io.to('tenant:' + c.tenantId).emit('mailboxes:changed', {});
    return details(c, r, id);
  });
  for (const action of ['reconnect', 'disable', 'enable'] as const)
    app.post('/api/mailboxes/:id/' + action, async (req) => {
      const c = requireTenantAdmin(req.ctx);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      await requireMailboxPerm(c, r.db, id, 'read');
      const box = await r.db
        .selectFrom('mailboxes')
        .select('receiving_protocol')
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .executeTakeFirstOrThrow();
      await r.db
        .updateTable('mailboxes')
        .set({
          status:
            action === 'disable'
              ? 'disabled'
              : box.receiving_protocol === 'local'
                ? 'active'
                : 'pending',
          last_error: null,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      if (action === 'disable') await r.queues['mailbox-sync'].removeJobScheduler('sync:' + id);
      else if (box.receiving_protocol !== 'local')
        await r.queues['mailbox-connection'].add('connect', { mailbox_id: id });
      await audit(r.db, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action:
          action === 'disable'
            ? 'mailbox.disabled'
            : action === 'enable'
              ? 'mailbox.enabled'
              : 'mailbox.updated',
        entityType: 'mailbox',
        entityId: id,
        ip: c.ip,
      });
      r.io.to('tenant:' + c.tenantId).emit('mailboxes:changed', {});
      return { ok: true };
    });
  app.get('/api/mailboxes/:id/members', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await requireMailboxPerm(c, r.db, id, 'read');
    return r.db
      .selectFrom('mailbox_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.user_id',
        'u.full_name',
        'u.email',
        'm.role',
        'm.restrict_to_folders',
        sql<
          string[]
        >`coalesce((select array_agg(p.folder_id) from folder_permissions p where p.tenant_id=m.tenant_id and p.mailbox_id=m.mailbox_id and p.user_id=m.user_id),'{}'::uuid[])`.as(
          'folder_ids',
        ),
      ])
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.mailbox_id', '=', id)
      .execute();
  });
  app.put('/api/mailboxes/:id/members/:userId', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const p = z.object({ id: z.uuid(), userId: z.uuid() }).parse(req.params);
    const b = z
      .object({
        role: mailboxRoleSchema.nullable(),
        restrict_to_folders: z.boolean().default(false),
        folder_ids: z.array(z.uuid()).max(1000).default([]),
      })
      .parse(req.body);
    await setMailboxMember(c, r, p.id, p.userId, b.role, b.restrict_to_folders, b.folder_ids);
    return { ok: true };
  });
}
