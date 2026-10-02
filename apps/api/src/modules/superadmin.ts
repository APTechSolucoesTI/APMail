import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { audit, asJson, safeAuditMetadata, writeMailboxCredential, type Json } from '@apmail/db';
import {
  tenantSchema,
  emailSchema,
  mailboxSchema,
  invitationSchema,
  memberAccessSchema,
} from '@apmail/shared';
import { saveMailboxAccess } from './tenants.js';
import { requireSuperAdmin, notFound, forbidden, type RequestContext } from '../authz/context.js';
import { newToken, hashToken } from '../plugins/auth.js';
import type { Resources } from './resources.js';
const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => [10, 20, 30, 50, 100].includes(n))
    .default(10),
  search: z.string().trim().max(120).default(''),
});
export async function registerSuperAdmin(app: FastifyInstance, r: Resources) {
  app.get('/api/superadmin/users/:id/access', async (req) => {
    requireSuperAdmin(req.ctx);
    const id = idOf(req.params),
      { tenant_id } = z.object({ tenant_id: z.uuid() }).parse(req.query);
    const member = await r.db
      .selectFrom('tenant_members')
      .select(['role', 'capabilities'])
      .where('tenant_id', '=', tenant_id)
      .where('user_id', '=', id)
      .executeTakeFirst();
    if (!member) throw notFound();
    const roles = await r.db
      .selectFrom('mailbox_members as m')
      .select([
        'm.mailbox_id',
        'm.role',
        'm.restrict_to_folders',
        sql<
          string[]
        >`coalesce((select array_agg(p.folder_id) from folder_permissions p where p.tenant_id=${tenant_id} and p.mailbox_id=m.mailbox_id and p.user_id=${id}),'{}'::uuid[])`.as(
          'folder_ids',
        ),
      ])
      .where('m.tenant_id', '=', tenant_id)
      .where('m.user_id', '=', id)
      .execute();
    return { tenant_role: member.role, capabilities: member.capabilities, mailbox_roles: roles };
  });
  app.put('/api/superadmin/users/:id/access', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      id = idOf(req.params),
      b = memberAccessSchema.extend({ tenant_id: z.uuid() }).parse(req.body);
    if (id === c.userId) throw forbidden();
    await r.db.transaction().execute(async (tx) => {
      const member = await tx
        .selectFrom('tenant_members')
        .select('role')
        .where('tenant_id', '=', b.tenant_id)
        .where('user_id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!member) throw notFound();
      await tx
        .updateTable('tenant_members')
        .set({
          role: b.tenant_role,
          capabilities: b.tenant_role === 'supervisor' ? b.capabilities : [],
        })
        .where('tenant_id', '=', b.tenant_id)
        .where('user_id', '=', id)
        .execute();
      for (const box of b.mailbox_roles) {
        const found = await tx
          .selectFrom('mailboxes')
          .select('id')
          .where('id', '=', box.mailbox_id)
          .where('tenant_id', '=', b.tenant_id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!found) throw notFound();
        await saveMailboxAccess(
          tx,
          b.tenant_id,
          box.mailbox_id,
          id,
          box.role,
          box.restrict_to_folders,
          box.folder_ids,
        );
      }
    });
    r.io.in('user:' + id).disconnectSockets(true);
    await record(c, 'platform.member_access_updated', b.tenant_id, {
      user_id: id,
      tenant_role: b.tenant_role,
      capabilities: b.capabilities,
      mailbox_ids: b.mailbox_roles.map((box) => box.mailbox_id),
    });
    return { ok: true };
  });
  app.get('/api/superadmin/tenants/:id/mailboxes', async (req) => {
    requireSuperAdmin(req.ctx);
    return r.db
      .selectFrom('mailboxes')
      .select(['id', 'name', 'email_address', 'status'])
      .where('tenant_id', '=', idOf(req.params))
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
  });
  app.get('/api/superadmin/tenants/:id/folders/:mailboxId', async (req) => {
    requireSuperAdmin(req.ctx);
    const p = z.object({ id: z.uuid(), mailboxId: z.uuid() }).parse(req.params);
    const rows = await r.db
      .selectFrom('folders')
      .select(['id', 'name', 'parent_id'])
      .where('tenant_id', '=', p.id)
      .where('mailbox_id', '=', p.mailboxId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
    const tree = (parent: string | null): unknown[] =>
      rows.filter((f) => f.parent_id === parent).map((f) => ({ ...f, children: tree(f.id) }));
    return tree(null);
  });
  app.post('/api/superadmin/invitations', async (req, reply) => {
    const c = requireSuperAdmin(req.ctx),
      b = invitationSchema
        .extend({
          tenant_id: z.uuid(),
          tenant_role: z.enum(['owner', 'admin', 'member', 'supervisor']),
        })
        .parse(req.body);
    const tenant = await r.db
      .selectFrom('tenants')
      .select(['id', 'name'])
      .where('id', '=', b.tenant_id)
      .where('deleted_at', 'is', null)
      .where('suspended_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) throw notFound();
    for (const entry of b.mailbox_roles) {
      const box = await r.db
        .selectFrom('mailboxes')
        .select('id')
        .where('id', '=', entry.mailbox_id)
        .where('tenant_id', '=', tenant.id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!box) throw notFound();
    }
    const inviter = await r.db
      .selectFrom('users')
      .select(['full_name', 'email'])
      .where('id', '=', c.userId)
      .executeTakeFirstOrThrow();
    if (inviter.email === b.email) throw forbidden();
    const token = newToken(),
      invite = await r.db
        .insertInto('invitations')
        .values({
          tenant_id: tenant.id,
          email: b.email,
          tenant_role: b.tenant_role,
          capabilities: b.tenant_role === 'supervisor' ? b.capabilities : [],
          mailbox_roles: asJson(b.mailbox_roles),
          sender_context: 'platform',
          invited_by: c.userId,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + 7 * 86400000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    await r.queues['system-email'].add(
      'invite',
      {
        to: b.email,
        invitation_id: invite.id,
        data: {
          link: r.env.APP_URL + '/accept-invite?token=' + token,
          tenant_name: tenant.name,
          inviter_name: inviter.full_name,
        },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true },
    );
    await record(c, 'platform.user_invited', tenant.id, {
      email: b.email,
      tenant_role: b.tenant_role,
    });
    return reply.code(201).send(invite);
  });
  app.get('/api/superadmin/users/:id/memberships', async (req) => {
    requireSuperAdmin(req.ctx);
    const id = idOf(req.params);
    return r.db
      .selectFrom('tenant_members as m')
      .innerJoin('tenants as t', 't.id', 'm.tenant_id')
      .select(['m.tenant_id', 'm.role', 'm.status', 't.name'])
      .where('m.user_id', '=', id)
      .where('t.deleted_at', 'is', null)
      .orderBy('t.name')
      .execute();
  });
  app.put('/api/superadmin/users/:id/status', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      id = idOf(req.params),
      b = z.object({ tenant_id: z.uuid(), status: z.enum(['active', 'disabled']) }).parse(req.body);
    const changed = await r.db
      .updateTable('tenant_members')
      .set({ status: b.status })
      .where('tenant_id', '=', b.tenant_id)
      .where('user_id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!changed) throw notFound();
    r.io.in('user:' + id).disconnectSockets(true);
    await record(c, 'platform.member_status_changed', b.tenant_id, {
      user_id: id,
      status: b.status,
    });
    return { ok: true };
  });
  async function record(
    c: RequestContext,
    action: string,
    tenantId: string | null = null,
    metadata: Record<string, unknown> = {},
  ) {
    const safe = safeAuditMetadata(JSON.parse(JSON.stringify(metadata)) as Json);
    await r.db
      .insertInto('platform_audit')
      .values({
        actor_id: c.userId,
        tenant_id: tenantId,
        action,
        request_id: c.requestId,
        metadata: asJson(safe),
      })
      .execute();
    if (tenantId)
      await audit(r.db, {
        tenantId,
        actorId: c.userId,
        action,
        entityType: 'platform',
        metadata: safe,
        ip: c.ip,
      });
  }
  app.get('/api/superadmin/tenants', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      q = pageSchema.parse(req.query);
    let query = r.db.selectFrom('tenants as t').where('t.deleted_at', 'is', null);
    if (q.search)
      query = query.where('t.name', 'ilike', '%' + q.search.replace(/[%_\\]/g, '\\$&') + '%');
    const count = await query
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await query
      .select([
        't.id',
        't.name',
        't.slug',
        't.created_at',
        't.suspended_at',
        sql<number>`(select count(*)::int from tenant_members m where m.tenant_id=t.id and m.status='active')`.as(
          'users',
        ),
        sql<number>`(select count(*)::int from mailboxes b where b.tenant_id=t.id and b.deleted_at is null)`.as(
          'mailboxes',
        ),
      ])
      .orderBy('t.created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    await record(c, 'platform.tenants_viewed');
    return { items, total: Number(count.n), page: q.page, pageSize: q.pageSize };
  });
  app.post('/api/superadmin/tenants', async (req, reply) => {
    const c = requireSuperAdmin(req.ctx),
      b = tenantSchema.extend({ owner_email: emailSchema }).parse(req.body);
    // Existing owners can be linked immediately; new owners receive a global SMTP invitation.
    const token = newToken();
    const result = await r.db.transaction().execute(async (tx) => {
      const tenant = await tx
        .insertInto('tenants')
        .values({ name: b.name, slug: b.slug })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();
      const owner = await tx
        .selectFrom('users')
        .select('id')
        .where('email', '=', b.owner_email)
        .executeTakeFirst();
      if (owner) {
        await tx
          .insertInto('tenant_members')
          .values({ tenant_id: tenant.id, user_id: owner.id, role: 'owner' })
          .execute();
        await tx
          .updateTable('users')
          .set({ current_tenant_id: tenant.id })
          .where('id', '=', owner.id)
          .where('current_tenant_id', 'is', null)
          .execute();
        return { tenant, invitation: null };
      }
      const invitation = await tx
        .insertInto('invitations')
        .values({
          tenant_id: tenant.id,
          email: b.owner_email,
          tenant_role: 'owner',
          invited_by: c.userId,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + 7 * 86400000),
          mailbox_roles: asJson([]),
          sender_context: 'platform',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { tenant, invitation };
    });
    if (result.invitation)
      await r.queues['system-email'].add(
        'invite',
        {
          to: b.owner_email,
          invitation_id: result.invitation.id,
          data: {
            link: r.env.APP_URL + '/accept-invite?token=' + token,
            tenant_name: result.tenant.name,
            inviter_name: 'Administração APMail',
          },
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true },
      );
    await record(c, 'platform.tenant_created', result.tenant.id, { owner_email: b.owner_email });
    return reply.code(201).send(result.tenant);
  });
  app.patch('/api/superadmin/tenants/:id', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      id = idOf(req.params),
      b = z.object({ suspended: z.boolean() }).parse(req.body);
    const row = await r.db
      .updateTable('tenants')
      .set({ suspended_at: b.suspended ? new Date() : null })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!row) throw notFound();
    r.io.in('tenant:' + id).disconnectSockets(true);
    await record(c, b.suspended ? 'platform.tenant_suspended' : 'platform.tenant_resumed', id);
    return { ok: true };
  });
  app.get('/api/superadmin/users', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = pageSchema.parse(req.query);
    let query = r.db.selectFrom('users');
    if (q.search)
      query = query.where((eb) =>
        eb.or([
          eb('email', 'ilike', '%' + q.search + '%'),
          eb('full_name', 'ilike', '%' + q.search + '%'),
        ]),
      );
    const count = await query
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await query
      .select(['id', 'email', 'full_name', 'created_at', 'last_login_at'])
      .orderBy('created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total: Number(count.n), page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/superadmin/mailboxes', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = pageSchema.parse(req.query);
    let query = r.db
      .selectFrom('mailboxes as b')
      .innerJoin('tenants as t', 't.id', 'b.tenant_id')
      .where('b.deleted_at', 'is', null);
    if (q.search) query = query.where('b.email_address', 'ilike', '%' + q.search + '%');
    const count = await query
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await query
      .select([
        'b.id',
        'b.tenant_id',
        'b.name',
        'b.email_address',
        'b.status',
        'b.last_synced_at',
        't.name as tenant_name',
      ])
      .orderBy('b.created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total: Number(count.n), page: q.page, pageSize: q.pageSize };
  });
  app.post('/api/superadmin/mailboxes', async (req, reply) => {
    const c = requireSuperAdmin(req.ctx),
      b = mailboxSchema.extend({ tenant_id: z.uuid() }).parse(req.body);
    const { password, members: _members, sync_days, tenant_id, ...data } = b;
    void _members;
    const tenant = await r.db
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', tenant_id)
      .where('deleted_at', 'is', null)
      .where('suspended_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) throw notFound();
    const box = await r.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('mailboxes')
        .values({
          ...data,
          tenant_id,
          created_by: c.userId,
          sync_since: new Date(Date.now() - sync_days * 86400000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeMailboxCredential(
        tx,
        tenant_id,
        row.id,
        password,
        r.env.CREDENTIALS_ENCRYPTION_KEY,
      );
      return row;
    });
    await r.queues['mailbox-connection'].add('connect', { mailbox_id: box.id });
    await record(c, 'platform.mailbox_created', tenant_id, { mailbox_id: box.id });
    return reply.code(201).send(box);
  });
  app.put('/api/superadmin/mailboxes/:id/credentials', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      id = idOf(req.params),
      b = z.object({ password: z.string().min(1).max(256) }).parse(req.body);
    const box = await r.db
      .selectFrom('mailboxes')
      .select(['id', 'tenant_id'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box) throw notFound();
    await writeMailboxCredential(
      r.db,
      box.tenant_id,
      id,
      b.password,
      r.env.CREDENTIALS_ENCRYPTION_KEY,
    );
    await r.queues['mailbox-connection'].add('connect', { mailbox_id: id });
    await record(c, 'platform.mailbox_credentials_replaced', box.tenant_id, { mailbox_id: id });
    return { ok: true };
  });
  app.post('/api/superadmin/support', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      b = z
        .object({ tenant_id: z.uuid(), reason: z.string().trim().min(10).max(500) })
        .parse(req.body);
    const tenant = await r.db
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', b.tenant_id)
      .where('deleted_at', 'is', null)
      .where('suspended_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) throw notFound();
    const support = await r.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('sessions')
        .select('token_hash')
        .where('token_hash', '=', c.sessionHash)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('support_sessions')
        .set({ ended_at: new Date() })
        .where('session_hash', '=', c.sessionHash)
        .where('ended_at', 'is', null)
        .execute();
      return tx
        .insertInto('support_sessions')
        .values({
          user_id: c.userId,
          session_hash: c.sessionHash,
          tenant_id: b.tenant_id,
          reason: b.reason,
          expires_at: new Date(Date.now() + 30 * 60000),
        })
        .returning(['id', 'expires_at'])
        .executeTakeFirstOrThrow();
    });
    await record(c, 'platform.support_started', b.tenant_id, {
      reason: b.reason,
      support_id: support.id,
      expires_at: support.expires_at.toISOString(),
    });
    r.io.in('session:' + c.sessionHash).disconnectSockets(true);
    return support;
  });
  app.delete('/api/superadmin/support', async (req) => {
    const c = requireSuperAdmin(req.ctx);
    const ended = await r.db
      .updateTable('support_sessions')
      .set({ ended_at: new Date() })
      .where('session_hash', '=', c.sessionHash)
      .where('ended_at', 'is', null)
      .returning(['id', 'tenant_id'])
      .execute();
    for (const support of ended)
      await record(c, 'platform.support_ended', support.tenant_id, { support_id: support.id });
    r.io.in('session:' + c.sessionHash).disconnectSockets(true);
    return { ok: true };
  });
  app.get('/api/superadmin/audit', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = pageSchema.parse(req.query);
    const count = await r.db
      .selectFrom('platform_audit')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await r.db
      .selectFrom('platform_audit as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .select([
        'a.id',
        'a.tenant_id',
        'a.action',
        'a.metadata',
        'a.created_at',
        'u.full_name as actor_name',
      ])
      .orderBy('a.created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total: Number(count.n), page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/superadmin/logs', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = pageSchema.parse(req.query);
    const count = await r.db
      .selectFrom('operational_logs')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await r.db
      .selectFrom('operational_logs')
      .select([
        'id',
        'tenant_id',
        'service',
        'level',
        'message',
        'request_id',
        'metadata',
        'created_at',
      ])
      .orderBy('created_at', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total: Number(count.n), page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/superadmin/health', async (req) => {
    requireSuperAdmin(req.ctx);
    await sql`select 1`.execute(r.db);
    const entries = await Promise.all(
      Object.entries(r.queues).map(async ([name, queue]) => [
        name,
        await queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      ]),
    );
    return {
      database: 'ok',
      redis: (await r.redis.ping()) === 'PONG' ? 'ok' : 'error',
      queues: Object.fromEntries(entries),
      worker_last_heartbeat: await r.redis.get('worker:heartbeat'),
      global_smtp_configured: !!(process.env.SYSTEM_SMTP_HOST && process.env.SYSTEM_MAIL_FROM),
    };
  });
}
