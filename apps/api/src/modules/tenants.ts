import { columnFilters, columnOrder } from './list-columns.js';
import { isTenantAdmin } from '@apmail/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import { audit, auditChanges, safeAuditMetadata, lockStorageTenant, type DB } from '@apmail/db';
import { AUDIT_ACTION_LABELS } from '@apmail/shared';
import {
  tenantSettingsSchema,
  timezoneSchema,
  memberAccessSchema,
  mailboxRoleSchema,
} from '@apmail/shared';
import {
  requireTenant,
  requireTenantAdmin,
  requireCapability,
  forbidden,
  notFound,
  ApiError,
  type RequestContext,
} from '../authz/context.js';
import { getMailboxRole, requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import { avatarUrl } from './auth.js';
import type { Resources } from './resources.js';
export async function requireMember(ctx: RequestContext, r: Resources, userId: string) {
  const c = requireTenant(ctx);
  const row = await r.db
    .selectFrom('tenant_members')
    .select(['id', 'role', 'status', 'capabilities'])
    .where('tenant_id', '=', c.tenantId)
    .where('user_id', '=', userId)
    .where('status', '!=', 'removed')
    .executeTakeFirst();
  if (!row) throw notFound();
  return row;
}
export async function emitAccessChanged(r: Resources, userId: string) {
  const sockets = await r.io.in('user:' + userId).fetchSockets();
  for (const s of sockets) {
    for (const room of s.rooms)
      if (room.startsWith('mailbox:') || room.startsWith('thread:')) await s.leave(room);
  }
  r.io.to('user:' + userId).emit('mailboxes:changed', {});
}
export async function saveMailboxAccess(
  db: Kysely<DB>,
  tenantId: string,
  mailboxId: string,
  userId: string,
  role: z.infer<typeof mailboxRoleSchema> | null,
  restrict = false,
  folderIds: string[] = [],
) {
  const ids = [...new Set(folderIds)];
  if (restrict && (!role || role === 'mailbox_admin'))
    throw new ApiError(400, 'validation_error', 'A restrição exige Editor ou Somente leitura.');
  if (restrict && ids.length) {
    const found = await db
      .selectFrom('folders')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('mailbox_id', '=', mailboxId)
      .where('deleted_at', 'is', null)
      .where('id', 'in', ids)
      .execute();
    if (found.length !== ids.length) throw notFound();
  }
  if (!role) {
    await db
      .deleteFrom('mailbox_members')
      .where('tenant_id', '=', tenantId)
      .where('mailbox_id', '=', mailboxId)
      .where('user_id', '=', userId)
      .execute();
    return;
  }
  await db
    .insertInto('mailbox_members')
    .values({
      tenant_id: tenantId,
      mailbox_id: mailboxId,
      user_id: userId,
      role,
      restrict_to_folders: restrict,
    })
    .onConflict((oc) =>
      oc.columns(['mailbox_id', 'user_id']).doUpdateSet({ role, restrict_to_folders: restrict }),
    )
    .execute();
  await db
    .deleteFrom('folder_permissions')
    .where('tenant_id', '=', tenantId)
    .where('mailbox_id', '=', mailboxId)
    .where('user_id', '=', userId)
    .execute();
  if (restrict && ids.length)
    await db
      .insertInto('folder_permissions')
      .values(
        ids.map((folder_id) => ({
          tenant_id: tenantId,
          mailbox_id: mailboxId,
          user_id: userId,
          folder_id,
        })),
      )
      .execute();
}
export async function setMailboxMember(
  ctx: RequestContext,
  r: Resources,
  mailboxId: string,
  userId: string,
  role: z.infer<typeof mailboxRoleSchema> | null,
  restrict = false,
  folderIds: string[] = [],
) {
  const c = requireTenantAdmin(ctx);
  await requireMailboxPerm(c, r.db, mailboxId, 'read');
  const member = await requireMember(c, r, userId);
  if (member.status !== 'active' && role)
    throw new ApiError(409, 'conflict', 'Reative o usuário antes de conceder acesso.');
  await r.db
    .transaction()
    .execute((tx) =>
      saveMailboxAccess(tx, c.tenantId, mailboxId, userId, role, restrict, folderIds),
    );
  await audit(r.db, {
    tenantId: c.tenantId,
    actorId: c.userId,
    action: 'mailbox_member.updated',
    entityType: 'mailbox',
    entityId: mailboxId,
    metadata: {
      user_id: userId,
      role,
      restrict_to_folders: restrict,
      folder_ids: restrict ? folderIds : [],
    },
    ip: c.ip,
  });
  await emitAccessChanged(r, userId);
}
export async function registerTenantRoutes(app: FastifyInstance, r: Resources) {
  app.get('/api/tenant', async (req) => {
    const c = requireTenant(req.ctx);
    return r.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
  });
  app.patch('/api/tenant', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const b = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        timezone: timezoneSchema.optional(),
        settings: tenantSettingsSchema.optional(),
      })
      .parse(req.body);
    if (b.settings?.default_invitation_mailbox_id) {
      const sender = await r.db
        .selectFrom('mailboxes')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', b.settings.default_invitation_mailbox_id)
        .where('status', '=', 'active')
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!sender)
        throw new ApiError(400, 'validation_error', 'Escolha uma caixa ativa da empresa.');
    }
    const old = await r.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    const next = await r.db
      .updateTable('tenants')
      .set({
        ...b,
        settings: b.settings ? sql`settings || ${JSON.stringify(b.settings)}::jsonb` : old.settings,
      })
      .where('id', '=', c.tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: c.tenantId,
      metadata: auditChanges(old, {
        name: next.name,
        timezone: next.timezone,
        settings: next.settings,
      }),
      ip: c.ip,
    });
    return next;
  });
  app.get('/api/members/directory', async (req) => {
    const c = requireTenant(req.ctx);
    const users = await r.db
      .selectFrom('tenant_members')
      .innerJoin('users', 'users.id', 'tenant_members.user_id')
      .select([
        'users.id',
        'users.email',
        'users.full_name',
        'users.avatar_path',
        'users.updated_at',
      ])
      .where('tenant_members.tenant_id', '=', c.tenantId)
      .where('tenant_members.status', '=', 'active')
      .orderBy('users.full_name')
      .execute();
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      avatar_url: avatarUrl(u),
    }));
  });
  app.get('/api/members', async (req) => {
    const c = requireCapability(req.ctx, 'members');
    const members = await r.db
      .selectFrom('tenant_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.user_id',
        'u.email',
        'u.full_name',
        'u.id',
        'u.avatar_path',
        'u.updated_at',
        'm.role',
        'm.status',
        'm.created_at',
        sql<number>`case when m.role in ('owner','admin') then (select count(*)::int from mailboxes b where b.tenant_id=${c.tenantId} and b.deleted_at is null) else (select count(*)::int from mailbox_members mm join mailboxes b on b.id=mm.mailbox_id where mm.user_id=m.user_id and mm.tenant_id=${c.tenantId} and b.tenant_id=${c.tenantId} and b.deleted_at is null) end`.as(
          'mailbox_count',
        ),
      ])
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.status', '!=', 'removed')
      .orderBy('u.full_name')
      .execute();
    const invitations = await r.db
      .selectFrom('invitations as i')
      .innerJoin('users as u', 'u.id', 'i.invited_by')
      .select([
        'i.id',
        'i.email',
        'i.tenant_role',
        'i.expires_at',
        'i.delivery_status',
        'i.delivery_error',
        'u.full_name as invited_by_name',
      ])
      .where('i.tenant_id', '=', c.tenantId)
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .execute();
    return {
      members: members.map((u) => ({
        user_id: u.user_id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        status: u.status,
        created_at: u.created_at,
        mailbox_count: u.mailbox_count,
        avatar_url: avatarUrl(u),
      })),
      invitations: isTenantAdmin(c.tenantRole) ? invitations : [],
    };
  });
  app.get('/api/members/:userId/access', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const member = await requireMember(c, r, userId);
    const boxes = await r.db
      .selectFrom('mailboxes as b')
      .leftJoin('mailbox_members as m', (join) =>
        join
          .onRef('m.mailbox_id', '=', 'b.id')
          .on('m.tenant_id', '=', c.tenantId)
          .on('m.user_id', '=', userId),
      )
      .select([
        'b.id as mailbox_id',
        'b.name as mailbox_name',
        'm.role',
        'm.restrict_to_folders',
        sql<
          string[]
        >`coalesce((select array_agg(p.folder_id) from folder_permissions p where p.tenant_id=${c.tenantId} and p.mailbox_id=b.id and p.user_id=${userId}),'{}'::uuid[])`.as(
          'folder_ids',
        ),
      ])
      .where('b.tenant_id', '=', c.tenantId)
      .where('b.deleted_at', 'is', null)
      .execute();
    return {
      tenant_role: member.role,
      capabilities: member.capabilities,
      mailbox_roles: boxes.map((b) => ({
        ...b,
        restrict_to_folders: b.restrict_to_folders ?? false,
      })),
    };
  });
  app.put('/api/members/:userId/access', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const b = memberAccessSchema.parse(req.body);
    const member = await requireMember(c, r, userId);
    if (
      c.tenantRole !== 'owner' &&
      (member.role === 'owner' || (member.role !== b.tenant_role && isTenantAdmin(b.tenant_role)))
    )
      throw forbidden();
    for (const box of b.mailbox_roles) await requireMailboxPerm(c, r.db, box.mailbox_id, 'read');
    await r.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('tenant_members')
        .set({
          role: b.tenant_role,
          capabilities: b.tenant_role === 'supervisor' ? b.capabilities : [],
        })
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', userId)
        .execute();
      for (const box of b.mailbox_roles) {
        await saveMailboxAccess(
          tx,
          c.tenantId,
          box.mailbox_id,
          userId,
          box.role,
          box.restrict_to_folders,
          box.folder_ids,
        );
      }
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'member.access_updated',
        entityType: 'user',
        entityId: userId,
        metadata: { before: { tenant_role: member.role }, after: b },
        ip: c.ip,
      });
    });
    await emitAccessChanged(r, userId);
    return { ok: true };
  });
  app.delete('/api/members/:userId', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    z.object({ confirm: z.literal(true) }).parse(req.body);
    if (userId === c.userId)
      throw new ApiError(409, 'conflict', 'Você não pode remover seu próprio acesso.');
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const member = await requireMember(c, { ...r, db: tx }, userId);
      if (member.role === 'owner' && c.tenantRole !== 'owner') throw forbidden();
      await tx
        .updateTable('tenant_members')
        .set({ status: 'removed' })
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', userId)
        .execute();
      await tx
        .deleteFrom('mailbox_members')
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', userId)
        .execute();
      const other = await tx
        .selectFrom('tenant_members')
        .select('tenant_id')
        .where('user_id', '=', userId)
        .where('status', '=', 'active')
        .where('tenant_id', '!=', c.tenantId)
        .executeTakeFirst();
      await tx
        .updateTable('users')
        .set({ current_tenant_id: other?.tenant_id ?? null })
        .where('id', '=', userId)
        .where('current_tenant_id', '=', c.tenantId)
        .execute();
      const account = await tx
        .selectFrom('users')
        .select('email')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('invitations')
        .set({ revoked_at: new Date() })
        .where('tenant_id', '=', c.tenantId)
        .where('email', '=', account.email)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'member.removed',
        entityType: 'user',
        entityId: userId,
        metadata: { previous_role: member.role },
        ip: c.ip,
      });
    });
    r.io.in('user:' + userId).disconnectSockets(true);
    await emitAccessChanged(r, userId);
    return { ok: true };
  });
  app.put('/api/members/:userId/status', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const b = z.object({ status: z.enum(['active', 'disabled']) }).parse(req.body);
    const member = await requireMember(c, r, userId);
    if (userId === c.userId)
      throw new ApiError(409, 'conflict', 'Você não pode desativar sua própria conta.');
    if (member.role === 'owner' && c.tenantRole !== 'owner') throw forbidden();
    await r.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('tenant_members')
        .set({ status: b.status })
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', userId)
        .execute();
      if (b.status === 'disabled') {
        const other = await tx
          .selectFrom('tenant_members')
          .select('tenant_id')
          .where('user_id', '=', userId)
          .where('status', '=', 'active')
          .where('tenant_id', '!=', c.tenantId)
          .executeTakeFirst();
        await tx
          .updateTable('users')
          .set({ current_tenant_id: other?.tenant_id ?? null })
          .where('id', '=', userId)
          .where('current_tenant_id', '=', c.tenantId)
          .execute();
      }
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'member.status_changed',
        entityType: 'user',
        entityId: userId,
        metadata: { before: member.status, after: b.status },
        ip: c.ip,
      });
    });
    r.io.in('user:' + userId).disconnectSockets(true);
    await emitAccessChanged(r, userId);
    return { ok: true };
  });
  for (const list of ['mentionable', 'assignable'] as const)
    app.get('/api/mailboxes/:id/' + list, async (req) => {
      const c = requireTenant(req.ctx);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      await requireMailboxPerm(c, r.db, id, 'read');
      const users = await r.db
        .selectFrom('tenant_members')
        .innerJoin('users', 'users.id', 'tenant_members.user_id')
        .select([
          'users.id',
          'users.full_name',
          'users.email',
          'users.avatar_path',
          'users.updated_at',
          'tenant_members.role',
        ])
        .where('tenant_members.tenant_id', '=', c.tenantId)
        .where('tenant_members.status', '=', 'active')
        .execute();
      const result = [];
      for (const u of users) {
        const uc = { ...c, userId: u.id, tenantRole: u.role, mailboxRoles: new Map() };
        const role = await getMailboxRole(uc, r.db, id);
        if (role && (list === 'mentionable' || role !== 'viewer'))
          result.push({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            avatar_url: avatarUrl(u),
          });
      }
      return result;
    });
  app.get('/api/audit-logs', async (req) => {
    const c = requireCapability(req.ctx, 'audit');
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(10),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        actor_id: z.uuid().optional(),
        actor_ids: z
          .string()
          .max(4000)
          .transform((value) => z.array(z.uuid()).max(100).parse(value.split(',')))
          .optional(),
        action: z.string().max(100).optional(),
        actions: z
          .string()
          .max(10000)
          .transform((value) =>
            z.array(z.string().min(1).max(100)).max(100).parse(value.split(',')),
          )
          .optional(),
        search: z.string().trim().max(200).optional(),
      })
      .parse(req.query);
    let query = r.db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .where('a.tenant_id', '=', c.tenantId);
    if (!isTenantAdmin(c.tenantRole)) {
      const memberships = await r.db
        .selectFrom('mailbox_members as mm')
        .innerJoin('mailboxes as b', 'b.id', 'mm.mailbox_id')
        .select('b.id')
        .where('mm.tenant_id', '=', c.tenantId)
        .where('mm.user_id', '=', c.userId)
        .where('b.deleted_at', 'is', null)
        .execute();
      const scopes = await Promise.all(
        memberships.map(
          async (box) =>
            sql`(m.mailbox_id=${box.id} and ${folderPredicate(await readableFolders(c, r.db, box.id))})`,
        ),
      );
      const allowed = scopes.length ? sql`(${sql.join(scopes, sql` or `)})` : sql`false`;
      query = query.where(sql<boolean>`(
        (a.entity_type='mailbox' and a.entity_id in (select b.id from mailboxes b join mailbox_members mm on mm.mailbox_id=b.id where mm.tenant_id=${c.tenantId} and mm.user_id=${c.userId} and b.deleted_at is null)) or
        (a.entity_type='thread' and exists(select 1 from messages m where m.thread_id=a.entity_id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${allowed})) or
        (a.entity_type='message' and exists(select 1 from messages m where m.id=a.entity_id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${allowed}))
      )`);
    }
    if (q.from) query = query.where('a.created_at', '>=', new Date(q.from));
    if (q.to) query = query.where('a.created_at', '<=', new Date(q.to));
    if (q.actor_id) query = query.where('a.actor_id', '=', q.actor_id);
    if (q.actor_ids?.length) query = query.where('a.actor_id', 'in', q.actor_ids);
    if (q.actions?.length) query = query.where('a.action', 'in', q.actions);
    if (q.action)
      query = query.where('a.action', 'like', q.action.replace(/[%_\\]/g, '\\$&') + '%');
    if (q.search) {
      const text = '%' + q.search.replace(/[%_\\]/g, '\\$&') + '%',
        actions = Object.entries(AUDIT_ACTION_LABELS)
          .filter(([, label]) =>
            label
              .toLocaleLowerCase('pt-BR')
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, '')
              .includes(
                q
                  .search!.toLocaleLowerCase('pt-BR')
                  .normalize('NFD')
                  .replace(/\p{Diacritic}/gu, ''),
              ),
          )
          .map(([key]) => key);
      query = query.where((eb) =>
        eb.or([
          eb('u.full_name', 'ilike', text),
          eb('a.action', 'ilike', text),
          ...(actions.length ? [eb('a.action', 'in', actions)] : []),
        ]),
      );
    }
    const columns = {
      action: sql`a.action`,
      actor_name: sql`u.full_name`,
      entity_type: sql`a.entity_type`,
      created_at: sql`a.created_at`,
    };
    query = query.where(columnFilters(req.query, columns));
    query = query.where(
      sql<boolean>`not (a.entity_type='contact' and ((a.metadata->>'scope'='personal' and a.actor_id is distinct from ${c.userId}::uuid) or exists(select 1 from contacts c where c.id=a.entity_id and c.scope='personal' and c.owner_user_id<>${c.userId})))`,
    );
    const count = await query
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await query
      .select([
        'a.id',
        'a.action',
        'a.entity_type',
        'a.entity_id',
        'a.metadata',
        'a.created_at',
        'u.full_name as actor_name',
      ])
      .orderBy(columnOrder(req.query, columns, sql`a.created_at desc`))
      .orderBy('a.id', 'desc')
      .offset((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .execute();
    return {
      items: items.map((item) => ({ ...item, metadata: safeAuditMetadata(item.metadata) })),
      total: Number(count.n),
      page: q.page,
      pageSize: q.pageSize,
    };
  });
}
