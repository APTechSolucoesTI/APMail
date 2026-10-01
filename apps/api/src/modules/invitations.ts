import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { audit } from '@apmail/db';
import { invitationSchema, fullNameSchema, passwordSchema } from '@apmail/shared';
import { requireTenantAdmin, forbidden, notFound, ApiError } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { hashToken, newToken, createSession } from '../plugins/auth.js';
import { hashPassword } from './auth.js';
import type { Resources } from './resources.js';
export async function registerInvitationRoutes(app: FastifyInstance, r: Resources) {
  async function send(to: string, token: string, tenantName: string, inviterId: string) {
    const inviter = await r.db
      .selectFrom('users')
      .select('full_name')
      .where('id', '=', inviterId)
      .executeTakeFirstOrThrow();
    await r.queues['system-email'].add(
      'invite',
      {
        to,
        data: {
          link: r.env.APP_URL + '/accept-invite?token=' + token,
          tenant_name: tenantName,
          inviter_name: inviter.full_name,
        },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true },
    );
  }
  app.post('/api/invitations', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx);
    const b = invitationSchema.parse(req.body);
    if (b.tenant_role === 'admin' && c.tenantRole !== 'owner') throw forbidden();
    for (const box of b.mailbox_roles) await requireMailboxPerm(c, r.db, box.mailbox_id, 'read');
    const exists = await r.db
      .selectFrom('tenant_members')
      .innerJoin('users', 'users.id', 'tenant_members.user_id')
      .select('users.id')
      .where('tenant_members.tenant_id', '=', c.tenantId)
      .where('tenant_members.status', '=', 'active')
      .where('users.email', '=', b.email)
      .executeTakeFirst();
    if (exists) throw new ApiError(409, 'conflict', 'Este e-mail já é membro da empresa.');
    const token = newToken();
    const invite = await r.db
      .insertInto('invitations')
      .values({
        ...b,
        mailbox_roles: sql`${JSON.stringify(b.mailbox_roles)}::jsonb`,
        tenant_id: c.tenantId,
        invited_by: c.userId,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 7 * 86400000),
      })
      .returning(['id', 'email', 'expires_at'])
      .executeTakeFirstOrThrow();
    const tenant = await r.db
      .selectFrom('tenants')
      .select('name')
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    await send(b.email, token, tenant.name, c.userId);
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'member.invited',
      entityType: 'invitation',
      entityId: invite.id,
      metadata: { email: b.email, tenant_role: b.tenant_role },
      ip: c.ip,
    });
    return reply.code(201).send(invite);
  });
  app.post('/api/invitations/:id/resend', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const inv = await r.db
      .selectFrom('invitations')
      .select(['email', 'tenant_role', 'invited_by'])
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!inv) throw notFound();
    if (inv.tenant_role === 'admin' && c.tenantRole !== 'owner') throw forbidden();
    const token = newToken();
    await r.db
      .updateTable('invitations')
      .set({ token_hash: hashToken(token), expires_at: new Date(Date.now() + 7 * 86400000) })
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .execute();
    const tenant = await r.db
      .selectFrom('tenants')
      .select('name')
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    await send(inv.email, token, tenant.name, inv.invited_by);
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'member.invited',
      entityType: 'invitation',
      entityId: id,
      metadata: { resent: true },
      ip: c.ip,
    });
    return { ok: true };
  });
  app.delete('/api/invitations/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const inv = await r.db
      .selectFrom('invitations')
      .select('tenant_role')
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!inv) throw notFound();
    if (inv.tenant_role === 'admin' && c.tenantRole !== 'owner') throw forbidden();
    await r.db
      .updateTable('invitations')
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .execute();
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'member.invite_revoked',
      entityType: 'invitation',
      entityId: id,
      ip: c.ip,
    });
    return { ok: true };
  });
  app.get('/api/invitations/by-token/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(30).max(100) }).parse(req.params);
    const row = await r.db
      .selectFrom('invitations as i')
      .innerJoin('tenants as t', 't.id', 'i.tenant_id')
      .innerJoin('users as u', 'u.id', 'i.invited_by')
      .select([
        'i.email',
        'i.expires_at',
        'i.accepted_at',
        'i.revoked_at',
        't.name as tenant_name',
        'u.full_name as inviter_name',
      ])
      .where('i.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!row) throw notFound();
    const user = await r.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', row.email)
      .executeTakeFirst();
    return {
      email: row.email,
      tenant_name: row.tenant_name,
      inviter_name: row.inviter_name,
      user_exists: !!user,
      expired: !!row.accepted_at || !!row.revoked_at || row.expires_at.getTime() < Date.now(),
    };
  });
  app.post('/api/invitations/by-token/:token/accept', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(30).max(100) }).parse(req.params);
    const b = z
      .object({ full_name: fullNameSchema.optional(), password: passwordSchema.optional() })
      .parse(req.body ?? {});
    const userId = await r.db.transaction().execute(async (tx) => {
      const i = await tx
        .selectFrom('invitations')
        .select(['id', 'tenant_id', 'email', 'tenant_role', 'mailbox_roles'])
        .where('token_hash', '=', hashToken(token))
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!i) throw new ApiError(409, 'conflict', 'Convite expirado ou já utilizado.');
      let u = await tx
        .selectFrom('users')
        .select('id')
        .where('email', '=', i.email)
        .executeTakeFirst();
      if (u) {
        if (req.ctx?.userId !== u.id)
          throw new ApiError(409, 'conflict', `Entre com a conta ${i.email} para aceitar.`);
      } else {
        if (!b.full_name || !b.password)
          throw new ApiError(400, 'validation_error', 'Informe nome e senha para criar sua conta.');
        u = await tx
          .insertInto('users')
          .values({
            email: i.email,
            full_name: b.full_name,
            password_hash: await hashPassword(b.password),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx.insertInto('user_preferences').values({ user_id: u.id }).execute();
      }
      await tx
        .insertInto('tenant_members')
        .values({ tenant_id: i.tenant_id, user_id: u.id, role: i.tenant_role, status: 'active' })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'user_id'])
            .doUpdateSet({ role: i.tenant_role, status: 'active' }),
        )
        .execute();
      const boxes = invitationSchema.shape.mailbox_roles.parse(i.mailbox_roles);
      for (const box of boxes) {
        const valid = await tx
          .selectFrom('mailboxes')
          .select('id')
          .where('tenant_id', '=', i.tenant_id)
          .where('id', '=', box.mailbox_id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (valid)
          await tx
            .insertInto('mailbox_members')
            .values({
              tenant_id: i.tenant_id,
              mailbox_id: box.mailbox_id,
              user_id: u.id,
              role: box.role,
            })
            .onConflict((oc) =>
              oc.columns(['mailbox_id', 'user_id']).doUpdateSet({ role: box.role }),
            )
            .execute();
      }
      await tx
        .updateTable('invitations')
        .set({ accepted_at: new Date() })
        .where('tenant_id', '=', i.tenant_id)
        .where('id', '=', i.id)
        .execute();
      await tx
        .updateTable('users')
        .set({ current_tenant_id: i.tenant_id })
        .where('id', '=', u.id)
        .execute();
      await audit(tx, {
        tenantId: i.tenant_id,
        actorId: u.id,
        action: 'member.joined',
        entityType: 'invitation',
        entityId: i.id,
        ip: req.ip,
      });
      return u.id;
    });
    r.io.in('user:' + userId).disconnectSockets(true);
    await createSession(r.db, r.env, req, reply, userId);
    return { ok: true };
  });
}
