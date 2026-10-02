import { isTenantAdmin } from '@apmail/shared';
import { MAILBOX_PERMS, can, canDelegate } from '@apmail/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { mailboxSchema, mailboxRoleSchema } from '@apmail/shared';
import { audit, auditChanges, writeMailboxCredential } from '@apmail/db';
import { requireTenant, requireTenantAdmin, type RequestContext } from '../authz/context.js';
import { getMailboxRole, requireMailboxPerm } from '../authz/guards.js';
import { requireMember, setMailboxMember } from './tenants.js';
import type { Resources } from './resources.js';
// Lista explícita: nenhuma query deste módulo lê mailbox_credentials.
const publicColumns = [
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
      (p) => can(role, p) || canDelegate(c.tenantRole, c.capabilities, p),
    ),
  };
}
export async function registerMailboxRoutes(app: FastifyInstance, r: Resources) {
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
            (p) => can(role, p) || canDelegate(c.tenantRole, c.capabilities, p),
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
    const b = mailboxSchema.parse(req.body);
    for (const m of b.members) await requireMember(c, r, m.user_id);
    const { password, members, sync_days, ...data } = b;
    const box = await r.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('mailboxes')
        .values({
          ...data,
          tenant_id: c.tenantId,
          created_by: c.userId,
          sync_since: new Date(Date.now() - sync_days * 86400000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeMailboxCredential(
        tx,
        c.tenantId,
        row.id,
        password,
        r.env.CREDENTIALS_ENCRYPTION_KEY,
      );
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
    await r.queues['mailbox-connection'].add('connect', { mailbox_id: box.id });
    r.io.to('tenant:' + c.tenantId).emit('mailboxes:changed', {});
    return reply.code(201).send(await details(c, r, box.id));
  });
  app.patch('/api/mailboxes/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await requireMailboxPerm(c, r.db, id, 'read');
    const b = mailboxSchema.partial().omit({ members: true }).parse(req.body);
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
    await r.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('mailboxes')
        .set({
          ...data,
          ...(sync_days ? { sync_since: new Date(Date.now() - sync_days * 86400000) } : {}),
          ...(changed ? { status: 'pending' as const, last_error: null } : {}),
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
    if (changed) await r.queues['mailbox-connection'].add('connect', { mailbox_id: id });
    r.io.to('tenant:' + c.tenantId).emit('mailboxes:changed', {});
    return details(c, r, id);
  });
  for (const action of ['reconnect', 'disable', 'enable'] as const)
    app.post('/api/mailboxes/:id/' + action, async (req) => {
      const c = requireTenantAdmin(req.ctx);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      await requireMailboxPerm(c, r.db, id, 'read');
      await r.db
        .updateTable('mailboxes')
        .set({ status: action === 'disable' ? 'disabled' : 'pending', last_error: null })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      if (action === 'disable') await r.queues['mailbox-sync'].removeJobScheduler('sync:' + id);
      else await r.queues['mailbox-connection'].add('connect', { mailbox_id: id });
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
