import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { audit, asJson, activeInvitationPredicate } from '@apmail/db';
import { can, hasAccess } from '@apmail/shared';
import { requireTenant, forbidden, conflict, notFound } from '../authz/context.js';
import { requireThread } from './mail.js';
import type { Resources } from './resources.js';

export async function registerThreadInvitations(app: FastifyInstance, r: Resources) {
  const management = async (
    ctx: import('../authz/context.js').RequestContext | null,
    id: string,
  ) => {
    const result = await requireThread(ctx, r, id, 'send');
    if (
      result.delegated ||
      (!can(result.role, 'assign_others') && result.thread.assigned_to !== result.c.userId)
    )
      throw forbidden();
    return result;
  };
  app.get('/api/thread-invitations', async (req) => {
    const c = requireTenant(req.ctx);
    return (
      await sql`select i.id,i.thread_id,i.mailbox_id,i.state,i.created_at,t.subject,
      b.name mailbox_name,b.email_address mailbox_email,u.full_name inviter_name
      from thread_service_invitations i join threads t on t.id=i.thread_id and t.tenant_id=i.tenant_id
      join mailboxes b on b.id=i.mailbox_id and b.tenant_id=i.tenant_id join users u on u.id=i.inviter_id
      where i.tenant_id=${c.tenantId} and i.invitee_id=${c.userId} and b.deleted_at is null
        and ${activeInvitationPredicate(c.tenantId, c.userId, sql`i.thread_id`)} and i.state='active'
      order by i.created_at desc,i.id`.execute(r.db)
    ).rows;
  });
  app.get('/api/threads/:id/invitations', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { c } = await management(req.ctx, id);
    const items = (
      await sql`select i.*,i.invitee_id user_id,u.full_name,u.email,inviter.full_name inviter_name
      from thread_service_invitations i join users u on u.id=i.invitee_id join users inviter on inviter.id=i.inviter_id
      where i.tenant_id=${c.tenantId} and i.thread_id=${id} order by i.created_at desc`.execute(
        r.db,
      )
    ).rows;
    const candidates = await r.db
      .selectFrom('tenant_members as tm')
      .innerJoin('users as u', 'u.id', 'tm.user_id')
      .leftJoin('access_profiles as p', (j) =>
        j.onRef('p.id', '=', 'tm.access_profile_id').onRef('p.tenant_id', '=', 'tm.tenant_id'),
      )
      .select([
        'u.id',
        'u.full_name',
        'u.email',
        'tm.role',
        sql<string[] | null>`coalesce(tm.custom_permissions,p.permissions)`.as('permissions'),
      ])
      .where('tm.tenant_id', '=', c.tenantId)
      .where('tm.status', '=', 'active')
      .where('u.id', '!=', c.userId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('platform_admins').select('user_id').whereRef('user_id', '=', 'u.id'),
          ),
        ),
      )
      .orderBy('u.full_name')
      .execute();
    return {
      items,
      users: candidates
        .filter(
          (u) =>
            hasAccess({ role: u.role, access_permissions: u.permissions }, 'mail') &&
            hasAccess({ role: u.role, access_permissions: u.permissions }, 'mail.send'),
        )
        .map(({ id, full_name, email }) => ({ id, full_name, email })),
    };
  });
  app.post('/api/threads/:id/invitations', async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      { user_id } = z.object({ user_id: z.uuid() }).parse(req.body);
    const { c, thread } = await management(req.ctx, id);
    if (user_id === c.userId) throw conflict('Escolha outra pessoa da empresa.');
    const result = await r.db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('threads')
        .select(['manual_done_at', 'deleted_at', 'queue_status'])
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.manual_done_at || current.deleted_at || current.queue_status === 'done')
        throw conflict('Reabra a conversa antes de criar outro convite.');
      const target = await tx
        .selectFrom('tenant_members as tm')
        .leftJoin('access_profiles as p', (j) =>
          j.onRef('p.id', '=', 'tm.access_profile_id').onRef('p.tenant_id', '=', 'tm.tenant_id'),
        )
        .select([
          'tm.role',
          sql<string[] | null>`coalesce(tm.custom_permissions,p.permissions)`.as('permissions'),
        ])
        .where('tm.tenant_id', '=', c.tenantId)
        .where('tm.user_id', '=', user_id)
        .where('tm.status', '=', 'active')
        .executeTakeFirst();
      if (
        !target ||
        !hasAccess({ role: target.role, access_permissions: target.permissions }, 'mail') ||
        !hasAccess({ role: target.role, access_permissions: target.permissions }, 'mail.send')
      )
        throw notFound();
      const platform = await tx
        .selectFrom('platform_admins')
        .select('user_id')
        .where('user_id', '=', user_id)
        .executeTakeFirst();
      if (platform) throw notFound();
      const inserted = (
        await sql<{
          id: string;
        }>`insert into thread_service_invitations(tenant_id,mailbox_id,thread_id,inviter_id,invitee_id)
        values(${c.tenantId},${thread.mailbox_id},${id},${c.userId},${user_id}) on conflict(tenant_id,thread_id,invitee_id) where state='active' do nothing returning id`.execute(
          tx,
        )
      ).rows[0];
      if (!inserted) throw conflict('Essa pessoa já tem um convite ativo para a conversa.');
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'thread.invited',
        entityType: 'thread',
        entityId: id,
        metadata: { invitation_id: inserted.id, invitee_id: user_id },
        ip: c.ip,
      });
      const notification = await tx
        .insertInto('notifications')
        .values({
          tenant_id: c.tenantId,
          user_id,
          type: 'assignment',
          title: 'Convite para atendimento',
          body: 'Você recebeu um convite para atender uma conversa.',
          link: '/invitations?thread=' + id,
          payload: asJson({
            thread_id: id,
            mailbox_id: thread.mailbox_id,
            invitation_id: inserted.id,
          }),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { id: inserted.id, notification };
    });
    r.io.to('user:' + user_id).emit('notification:new', { notification: result.notification });
    r.io.to('user:' + user_id).emit('thread-invitations:changed', {});
    return reply.code(201).send({ id: result.id });
  });
  app.delete('/api/threads/:id/invitations/:invitationId', async (req) => {
    const { id, invitationId } = z
      .object({ id: z.uuid(), invitationId: z.uuid() })
      .parse(req.params);
    const { c } = await management(req.ctx, id);
    const closed = (
      await sql<{
        invitee_id: string;
      }>`update thread_service_invitations set state='revoked',closed_at=now(),closed_by=${c.userId}
      where id=${invitationId} and thread_id=${id} and tenant_id=${c.tenantId} and state='active' returning invitee_id`.execute(
        r.db,
      )
    ).rows[0];
    if (!closed) throw notFound();
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'thread.invitation_revoked',
      entityType: 'thread',
      entityId: id,
      metadata: { invitation_id: invitationId, invitee_id: closed.invitee_id },
    });
    r.io.to('user:' + closed.invitee_id).emit('thread-invitations:changed', {});
    // Drop the resource subscription immediately; a new subscribe revalidates access.
    const sockets = await r.io.in('user:' + closed.invitee_id).fetchSockets();
    for (const socket of sockets) await socket.leave('thread:' + id);
    return { ok: true };
  });
}
