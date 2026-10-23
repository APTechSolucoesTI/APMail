import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, type Database } from '@apmail/db';
import {
  accessPermissionSchema,
  legacyAccessPermissions,
  permissionKeys,
  profileMissingDependencies,
  hasAccess,
} from '@apmail/shared';
import {
  requireTenantAdmin,
  notFound,
  forbidden,
  ApiError,
  type RequestContext,
} from '../authz/context.js';
import { emitAccessChanged } from './tenants.js';
import type { Resources } from './resources.js';

export async function registerUserPermissions(app: FastifyInstance, r: Resources) {
  const read = async (c: RequestContext, userId: string, db: Database = r.db) => {
    const row = await db
      .selectFrom('tenant_members as m')
      .leftJoin('access_profiles as p', (j) =>
        j.onRef('p.id', '=', 'm.access_profile_id').onRef('p.tenant_id', '=', 'm.tenant_id'),
      )
      .select([
        'm.role',
        'm.status',
        'm.capabilities',
        'm.custom_permissions',
        'm.access_profile_id',
        'p.name',
        'p.permissions',
      ])
      .where('m.tenant_id', '=', c.tenantId!)
      .where('m.user_id', '=', userId)
      .where('m.status', '!=', 'removed')
      .executeTakeFirst();
    if (!row) throw notFound();
    const base = row.access_profile_id
      ? (row.permissions ?? [])
      : legacyAccessPermissions(row.role, row.capabilities);
    const system = !row.access_profile_id
      ? await db
          .selectFrom('access_profiles')
          .select('name')
          .where('tenant_id', '=', c.tenantId!)
          .where('system_role', '=', row.role)
          .executeTakeFirst()
      : null;
    return { row, base, name: row.name ?? system?.name ?? row.role };
  };
  app.get('/api/members/:userId/permissions', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'users.manage'),
      { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const { row, base, name } = await read(c, userId);
    return {
      access_profile_id: row.access_profile_id,
      profile_name: name,
      base_permissions: base,
      permissions: row.custom_permissions ?? base,
      customized: row.custom_permissions !== null,
    };
  });
  app.put('/api/members/:userId/permissions', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'users.manage'),
      { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const body = z
      .object({
        permissions: z.array(accessPermissionSchema).max(permissionKeys.length).nullable(),
      })
      .strict()
      .parse(req.body);
    const permissions = body.permissions === null ? null : [...new Set(body.permissions)];
    await r.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('tenants')
        .select('id')
        .where('id', '=', c.tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const { row, base, name } = await read(c, userId, tx);
      const actor = await read(c, c.userId, tx);
      const actorPermissions =
        actor.row.custom_permissions ?? (actor.row.access_profile_id ? actor.base : null);
      const restricted = actorPermissions !== null;
      if (
        actor.row.status !== 'active' ||
        !hasAccess({ role: actor.row.role, access_permissions: actorPermissions }, 'users.manage')
      )
        throw forbidden();
      if (
        ((row.role === 'owner' || row.role === 'admin') && permissions !== null) ||
        (row.role === 'owner' && actor.row.role !== 'owner') ||
        (restricted && (userId === c.userId || row.role === 'admin'))
      )
        throw forbidden();
      if (profileMissingDependencies(permissions ?? base).length)
        throw new ApiError(
          400,
          'validation_error',
          'Inclua os acessos necessários às ações selecionadas.',
        );
      if (restricted && (permissions ?? base).some((p) => !actorPermissions?.includes(p)))
        throw forbidden();
      await tx
        .updateTable('tenant_members')
        .set({ custom_permissions: permissions })
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', userId)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'member.access_updated',
        entityType: 'user',
        entityId: userId,
        metadata: {
          operation:
            permissions === null ? 'personal_permissions_reset' : 'personal_permissions_updated',
          profile_name: name,
          before: row.custom_permissions ?? base,
          after: permissions ?? base,
        },
        ip: c.ip,
        requestId: req.id,
      });
    });
    await emitAccessChanged(r, userId, true);
    return { ok: true };
  });
}
