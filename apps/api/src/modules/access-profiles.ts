import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { sql } from 'kysely';
import { audit, type DB } from '@apmail/db';
import { accessProfileSchema, profileMissingDependencies } from '@apmail/shared';
import {
  requireTenant,
  requireTenantAdmin,
  requireCapability,
  ApiError,
  forbidden,
  notFound,
  type RequestContext,
} from '../authz/context.js';
import type { Resources } from './resources.js';

export async function assertProfileGrant(
  db: Kysely<DB>,
  c: RequestContext & { tenantId: string },
  profileId: string | null | undefined,
  role: string,
) {
  if (!profileId) {
    if (c.accessProfileId)
      throw new ApiError(
        403,
        'forbidden',
        'Escolha um perfil personalizado com permissões iguais ou inferiores às suas.',
      );
    return null;
  }
  if (role !== 'member')
    throw new ApiError(
      400,
      'validation_error',
      'Um perfil personalizado substitui o papel Membro.',
    );
  const profile = await db
    .selectFrom('access_profiles')
    .selectAll()
    .where('tenant_id', '=', c.tenantId)
    .where('id', '=', profileId)
    .executeTakeFirst();
  if (!profile) throw notFound();
  if (c.accessProfileId && profile.permissions.some((p) => !c.accessPermissions?.includes(p)))
    throw new ApiError(403, 'forbidden', 'Você não pode conceder permissões superiores às suas.');
  return profile;
}
export async function registerAccessProfileRoutes(app: FastifyInstance, r: Resources) {
  app.get('/api/access-profiles', async (req) => {
    const c = requireTenant(req.ctx);
    if (!c.accessProfileId) requireCapability(req.ctx, 'members');
    // Assigned members can read their own description; the editor additionally needs team access.
    if (
      c.accessProfileId &&
      !c.accessPermissions?.some((p) => ['users.view', 'profiles.manage'].includes(p))
    )
      throw forbidden();
    return r.db
      .selectFrom('access_profiles as p')
      .selectAll('p')
      .select([
        sql<number>`(select count(*)::int from tenant_members m where m.tenant_id=p.tenant_id and m.access_profile_id=p.id and m.status<>'removed')`.as(
          'member_count',
        ),
        sql<number>`(select count(*)::int from invitations i where i.tenant_id=p.tenant_id and i.access_profile_id=p.id and i.accepted_at is null and i.revoked_at is null and i.expires_at>now())`.as(
          'invitation_count',
        ),
      ])
      .where('p.tenant_id', '=', c.tenantId)
      .orderBy('p.name')
      .execute();
  });
  for (const method of ['POST', 'PUT'] as const)
    app.route({
      method,
      url: '/api/access-profiles' + (method === 'PUT' ? '/:id' : ''),
      handler: async (req, reply) => {
        const c = requireTenantAdmin(req.ctx, 'profiles.manage');
        const b = accessProfileSchema.parse(req.body);
        if (profileMissingDependencies(b.permissions).length)
          throw new ApiError(
            400,
            'validation_error',
            'Inclua também o acesso à tela relacionada às ações selecionadas.',
          );
        if (c.accessProfileId && b.permissions.some((p) => !c.accessPermissions?.includes(p)))
          throw forbidden();
        const id = method === 'PUT' ? z.object({ id: z.uuid() }).parse(req.params).id : null;
        const profile = await r.db.transaction().execute(async (tx) => {
          // Serialize profile editing and assignments; revocation takes effect on the next request.
          await tx
            .selectFrom('tenants')
            .select('id')
            .where('id', '=', c.tenantId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const old = id
            ? await tx
                .selectFrom('access_profiles')
                .selectAll()
                .where('tenant_id', '=', c.tenantId)
                .where('id', '=', id)
                .executeTakeFirst()
            : null;
          if (id && !old) throw notFound();
          if (
            old &&
            c.accessProfileId &&
            old.permissions.some((p) => !c.accessPermissions?.includes(p))
          )
            throw forbidden();
          if (id && c.accessProfileId === id)
            throw new ApiError(
              409,
              'conflict',
              'Peça a outro administrador para alterar seu próprio perfil.',
            );
          const duplicate = await tx
            .selectFrom('access_profiles')
            .select('id')
            .where('tenant_id', '=', c.tenantId)
            .where(sql<boolean>`lower(name)=lower(${b.name})`)
            .executeTakeFirst();
          if (duplicate && duplicate.id !== id)
            throw new ApiError(409, 'conflict', 'Já existe um perfil com esse nome.');
          const row = id
            ? await tx
                .updateTable('access_profiles')
                .set(b)
                .where('id', '=', id)
                .where('tenant_id', '=', c.tenantId)
                .returningAll()
                .executeTakeFirstOrThrow()
            : await tx
                .insertInto('access_profiles')
                .values({ ...b, tenant_id: c.tenantId, created_by: c.userId })
                .returningAll()
                .executeTakeFirstOrThrow();
          await audit(tx, {
            tenantId: c.tenantId,
            actorId: c.userId,
            action: id ? 'access_profile.updated' : 'access_profile.created',
            entityType: 'access_profile',
            entityId: row.id,
            metadata: {
              name: row.name,
              before: old ? { name: old.name, permissions: old.permissions } : null,
              after: b,
            },
            ip: c.ip,
            requestId: req.id,
          });
          return row;
        });
        // Disconnect sockets so removed module permissions do not leave stale subscriptions.
        if (id) {
          const users = await r.db
            .selectFrom('tenant_members')
            .select('user_id')
            .where('tenant_id', '=', c.tenantId)
            .where('access_profile_id', '=', id)
            .execute();
          for (const u of users) {
            r.io.to('user:' + u.user_id).emit('access:changed', {});
            r.io.in('user:' + u.user_id).disconnectSockets(true);
          }
        }
        return reply.code(id ? 200 : 201).send(profile);
      },
    });
  app.delete('/api/access-profiles/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'profiles.manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await r.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('tenants')
        .select('id')
        .where('id', '=', c.tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const row = await assertProfileGrant(tx, c, id, 'member');
      const assigned = await tx
        .selectFrom('tenant_members')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('access_profile_id', '=', id)
        .where('status', '!=', 'removed')
        .executeTakeFirst();
      const invited = await tx
        .selectFrom('invitations')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('access_profile_id', '=', id)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .executeTakeFirst();
      if (assigned || invited)
        throw new ApiError(
          409,
          'profile_in_use',
          'Reatribua os usuários e revogue os convites pendentes antes de excluir este perfil.',
        );
      await tx
        .updateTable('tenant_members')
        .set({ access_profile_id: null })
        .where('tenant_id', '=', c.tenantId)
        .where('access_profile_id', '=', id)
        .where('status', '=', 'removed')
        .execute();
      await tx
        .updateTable('invitations')
        .set({ access_profile_id: null })
        .where('tenant_id', '=', c.tenantId)
        .where('access_profile_id', '=', id)
        .execute();
      await tx
        .deleteFrom('access_profiles')
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'access_profile.deleted',
        entityType: 'access_profile',
        entityId: id,
        metadata: { name: row!.name, permissions: row!.permissions },
        ip: c.ip,
        requestId: req.id,
      });
    });
    return { ok: true };
  });
}
