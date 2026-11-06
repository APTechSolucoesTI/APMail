import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { audit } from '@apmail/db';
import { isWithinAccessSchedule, profileAllowsMailbox } from '@apmail/shared';
import { ApiError, notFound, requireTenantAdmin } from '../authz/context.js';
import { hashToken, newToken } from '../plugins/auth.js';
import type { Resources } from './resources.js';
import { integrationNotificationCounts } from './integration-notification-counts.js';
import { integrationApiAccess } from './integration-api-access.js';
import { integrationApiRoutes } from './integration-api-routes.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expires_in_days: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .nullable()
    .default(90),
});
const accessSchema = z
  .object({
    permissions: z
      .array(
        z
          .string()
          .refine(
            (permission) => integrationApiRoutes.some((route) => route.permission === permission),
            'Rota de integração indisponível.',
          ),
      )
      .max(integrationApiRoutes.length)
      .transform((items) => [...new Set(items)]),
    user_ids: z
      .array(z.uuid())
      .max(1000)
      .transform((ids) => [...new Set(ids)]),
  })
  .refine(
    (value) => !value.permissions.includes('notifications:read') || value.user_ids.length > 0,
    { message: 'Selecione ao menos um usuário para a rota de notificações.', path: ['user_ids'] },
  );
const idSchema = z.object({ id: z.uuid() });
const notificationQuery = z.object({
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
});
const unavailableUser = () =>
  new ApiError(
    404,
    'notification_scope_unavailable',
    'Consulta indisponível para o escopo desta integração.',
  );
const issueToken = () => 'apmail_api_' + newToken();
const expiresIn = (days: number | null) =>
  days === null ? null : new Date(Date.now() + days * 86_400_000);

export function registerIntegrationTokens(app: FastifyInstance, r: Resources) {
  app.get('/api/integrations/api-tokens', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    reply.header('Cache-Control', 'no-store');
    const [tokens, users, tenant] = await Promise.all([
      r.db
        .selectFrom('integration_api_tokens as t')
        .select([
          't.id',
          't.name',
          't.permissions',
          't.created_at',
          't.expires_at',
          't.revoked_at',
          sql<boolean>`coalesce(t.expires_at<=now(),false)`.as('expired'),
          sql<
            string[]
          >`array(select s.user_id::text from integration_api_token_users s where s.tenant_id=t.tenant_id and s.token_id=t.id order by s.user_id)`.as(
            'user_ids',
          ),
        ])
        .where('t.tenant_id', '=', c.tenantId)
        .orderBy('t.created_at', 'desc')
        .execute(),
      r.db
        .selectFrom('tenant_members as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.full_name', 'u.email'])
        .where('m.tenant_id', '=', c.tenantId)
        .where('m.status', '=', 'active')
        .where(sql<boolean>`not exists(select 1 from platform_admins p where p.user_id=u.id)`)
        .orderBy('u.full_name')
        .execute(),
      r.db
        .selectFrom('tenants')
        .select(['id', 'name'])
        .where('id', '=', c.tenantId)
        .executeTakeFirstOrThrow(),
    ]);
    return { tokens, users, tenant, routes: integrationApiRoutes };
  });

  app.post('/api/integrations/api-tokens', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    const b = createSchema.parse(req.body);
    const token = issueToken();
    const saved = await r.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('integration_api_tokens')
        .values({
          tenant_id: c.tenantId,
          name: b.name,
          token_hash: hashToken(token),
          created_by: c.userId,
          expires_at: expiresIn(b.expires_in_days),
        })
        .returning(['id', 'name', 'permissions', 'expires_at'])
        .executeTakeFirstOrThrow();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.api_token.created',
        entityType: 'integration',
        entityId: row.id,
        metadata: { name: b.name },
        requestId: req.id,
        ip: req.ip,
      });
      return row;
    });
    return reply
      .code(201)
      .header('Cache-Control', 'no-store')
      .send({ ...saved, token });
  });

  app.post('/api/integrations/api-tokens/:id/rotate', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    const { id } = idSchema.parse(req.params);
    const token = issueToken();
    const saved = await r.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('integration_api_tokens')
        .set({
          token_hash: hashToken(token),
          expires_at: sql<Date | null>`case when expires_at is null then null else ${expiresIn(90)}::timestamptz end`,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .returning(['id', 'name', 'permissions', 'expires_at'])
        .executeTakeFirst();
      if (!row) throw notFound();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.api_token.rotated',
        entityType: 'integration',
        entityId: id,
        requestId: req.id,
        ip: req.ip,
      });
      return row;
    });
    return reply.header('Cache-Control', 'no-store').send({ ...saved, token });
  });

  app.delete('/api/integrations/api-tokens/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    const { id } = idSchema.parse(req.params);
    return r.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('integration_api_tokens')
        .set({ revoked_at: new Date() })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw notFound();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.api_token.revoked',
        entityType: 'integration',
        entityId: id,
        requestId: req.id,
        ip: req.ip,
      });
      return { success: true };
    });
  });

  app.put('/api/integrations/api-tokens/:id/access', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    const { id } = idSchema.parse(req.params);
    const b = accessSchema.parse(req.body);
    return r.db.transaction().execute(async (tx) => {
      const token = await tx
        .selectFrom('integration_api_tokens')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!token) throw notFound();
      if (b.user_ids.length) {
        const users = await tx
          .selectFrom('tenant_members as m')
          .select('m.user_id')
          .where('m.tenant_id', '=', c.tenantId)
          .where('m.status', '=', 'active')
          .where('m.user_id', 'in', b.user_ids)
          .where(
            sql<boolean>`not exists(select 1 from platform_admins p where p.user_id=m.user_id)`,
          )
          .execute();
        if (users.length !== b.user_ids.length) throw unavailableUser();
      }
      await tx
        .updateTable('integration_api_tokens')
        .set({ permissions: b.permissions })
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .execute();
      await tx
        .deleteFrom('integration_api_token_users')
        .where('tenant_id', '=', c.tenantId)
        .where('token_id', '=', id)
        .execute();
      if (b.user_ids.length) {
        await tx
          .insertInto('integration_api_token_users')
          .values(b.user_ids.map((user_id) => ({ tenant_id: c.tenantId, token_id: id, user_id })))
          .execute();
      }
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.api_token.access_updated',
        entityType: 'integration',
        entityId: id,
        metadata: { permissions: b.permissions, authorized_users: b.user_ids.length },
        requestId: req.id,
        ip: req.ip,
      });
      return { success: true };
    });
  });

  const access = integrationApiAccess(app, r);

  app.get(
    '/api/integrations/notifications',
    {
      onRequest: access.requirePermission('notifications:read'),
      config: {
        rateLimit: {
          max: 1200,
          timeWindow: '1 minute',
          keyGenerator: (req) => 'notification:' + access.scope(req).id,
        },
      },
    },
    async (req) => {
      const scope = access.scope(req);
      const { email } = notificationQuery.parse(req.query);
      const user = await r.db
        .selectFrom('integration_api_token_users as s')
        .innerJoin('tenant_members as m', (j) =>
          j.onRef('m.tenant_id', '=', 's.tenant_id').onRef('m.user_id', '=', 's.user_id'),
        )
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .innerJoin('tenants as t', 't.id', 'm.tenant_id')
        .leftJoin('access_profiles as p', (j) =>
          j.onRef('p.id', '=', 'm.access_profile_id').onRef('p.tenant_id', '=', 'm.tenant_id'),
        )
        .select([
          'u.id',
          'm.role',
          'm.access_schedule',
          't.timezone',
          sql<
            string[] | null
          >`case when m.custom_permissions is not null then m.custom_permissions when m.access_profile_id is not null then coalesce(p.permissions,array[]::text[]) else null end`.as(
            'permissions',
          ),
        ])
        .where('s.token_id', '=', scope.id)
        .where('s.tenant_id', '=', scope.tenantId)
        .where('u.email', '=', email)
        .where('m.status', '=', 'active')
        .where(
          sql<boolean>`not exists(select 1 from platform_admins platform where platform.user_id=u.id)`,
        )
        .executeTakeFirst();
      if (
        !user ||
        !profileAllowsMailbox({ role: user.role, access_permissions: user.permissions }, 'read') ||
        !isWithinAccessSchedule(user.access_schedule, user.timezone)
      )
        throw unavailableUser();
      const counts = await integrationNotificationCounts(r.db, scope.tenantId, user.id);
      return {
        success: true,
        data: { email, ...counts, hasNotifications: counts.unread > 0 || counts.pending > 0 },
      };
    },
  );
}
