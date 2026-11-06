import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { audit } from '@apmail/db';
import { isWithinAccessSchedule, profileAllowsMailbox } from '@apmail/shared';
import { ApiError, notFound, requireTenantAdmin } from '../authz/context.js';
import { hashToken, newToken } from '../plugins/auth.js';
import type { Resources } from './resources.js';
import { integrationNotificationCounts } from './integration-notification-counts.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  user_ids: z
    .array(z.uuid())
    .min(1)
    .max(1000)
    .transform((ids) => [...new Set(ids)]),
  expires_in_days: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90),
});
const idSchema = z.object({ id: z.uuid() });
const notificationQuery = z.object({
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
});
const invalidToken = () =>
  new ApiError(401, 'invalid_integration_token', 'Token de integração inválido ou indisponível.');
const unavailableUser = () =>
  new ApiError(
    404,
    'notification_scope_unavailable',
    'Consulta indisponível para o escopo desta integração.',
  );
const issueToken = () => 'apmail_ntf_' + newToken();
const expiresIn = (days: number) => new Date(Date.now() + days * 86_400_000);

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
          't.permission',
          't.created_at',
          't.expires_at',
          't.revoked_at',
          sql<boolean>`t.expires_at<=now()`.as('expired'),
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
    return { tokens, users, tenant };
  });

  app.post('/api/integrations/api-tokens', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    const b = createSchema.parse(req.body);
    const token = issueToken();
    const saved = await r.db.transaction().execute(async (tx) => {
      const users = await tx
        .selectFrom('tenant_members as m')
        .select('m.user_id')
        .where('m.tenant_id', '=', c.tenantId)
        .where('m.status', '=', 'active')
        .where('m.user_id', 'in', b.user_ids)
        .where(sql<boolean>`not exists(select 1 from platform_admins p where p.user_id=m.user_id)`)
        .execute();
      if (users.length !== b.user_ids.length) throw unavailableUser();
      const row = await tx
        .insertInto('integration_api_tokens')
        .values({
          tenant_id: c.tenantId,
          name: b.name,
          token_hash: hashToken(token),
          created_by: c.userId,
          expires_at: expiresIn(b.expires_in_days),
        })
        .returning(['id', 'name', 'permission', 'expires_at'])
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('integration_api_token_users')
        .values(b.user_ids.map((user_id) => ({ tenant_id: c.tenantId, token_id: row.id, user_id })))
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.api_token.created',
        entityType: 'integration',
        entityId: row.id,
        metadata: { name: b.name, authorized_users: users.length },
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
        .set({ token_hash: hashToken(token), expires_at: expiresIn(90) })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .returning(['id', 'name', 'permission', 'expires_at'])
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

  // Keep integration identity separate from interactive sessions and their mutation hooks.
  const scopes = new WeakMap<FastifyRequest, { id: string; tenantId: string }>();
  const throttleInvalid = app.rateLimit({
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => 'notification-invalid:' + req.ip,
  });
  async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store').header('Vary', 'Authorization');
    if (r.env.NODE_ENV === 'production' && req.protocol !== 'https') {
      throw new ApiError(403, 'https_required', 'Utilize HTTPS para consultar esta API.');
    }
    const match = /^Bearer (apmail_ntf_[A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? '');
    const row = match
      ? await r.db
          .selectFrom('integration_api_tokens as i')
          .innerJoin('tenants as t', 't.id', 'i.tenant_id')
          .select(['i.id', 'i.tenant_id'])
          .where('i.token_hash', '=', hashToken(match[1]!))
          .where('i.permission', '=', 'notifications:read')
          .where('i.revoked_at', 'is', null)
          .where('i.expires_at', '>', new Date())
          .where('t.deleted_at', 'is', null)
          .where('t.suspended_at', 'is', null)
          .executeTakeFirst()
      : undefined;
    if (!row) {
      await throttleInvalid.call(app, req, reply);
      if (reply.sent) return;
      reply.header('WWW-Authenticate', 'Bearer');
      throw invalidToken();
    }
    scopes.set(req, { id: row.id, tenantId: row.tenant_id });
  }

  app.get(
    '/api/integrations/notifications',
    {
      onRequest: authenticate,
      config: {
        rateLimit: {
          max: 1200,
          timeWindow: '1 minute',
          keyGenerator: (req) => 'notification:' + scopes.get(req)!.id,
        },
      },
    },
    async (req) => {
      const scope = scopes.get(req)!;
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
