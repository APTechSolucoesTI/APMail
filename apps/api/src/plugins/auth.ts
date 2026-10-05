import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '@apmail/db';
import type { Redis } from 'ioredis';
import type { ApiEnv } from '../env.js';
import { ApiError, type RequestContext } from '../authz/context.js';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export async function contextForToken(
  db: Kysely<DB>,
  redis: Redis,
  token: string,
  ip: string,
  requestId: string,
): Promise<RequestContext | null> {
  const hash = hashToken(token);
  // O cache guarda somente a identidade. Associação ativa é relida em cada requisição.
  const session = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['sessions.user_id', 'sessions.last_seen_at', 'users.current_tenant_id'])
    .where('sessions.token_hash', '=', hash)
    .where('sessions.expires_at', '>', new Date())
    .executeTakeFirst();
  if (!session) return null;
  await redis.set('session:' + hash, JSON.stringify({ userId: session.user_id }), 'EX', 60);
  if (Date.now() - session.last_seen_at.getTime() > 300000)
    await db
      .updateTable('sessions')
      .set({ last_seen_at: new Date() })
      .where('token_hash', '=', hash)
      .execute();
  const member = session.current_tenant_id
    ? await db
        .selectFrom('tenant_members')
        .innerJoin('tenants', 'tenants.id', 'tenant_members.tenant_id')
        .select(['tenant_members.tenant_id', 'tenant_members.role', 'tenant_members.capabilities'])
        .where('tenant_members.user_id', '=', session.user_id)
        .where('tenant_members.tenant_id', '=', session.current_tenant_id)
        .where('tenant_members.status', '=', 'active')
        .where('tenants.deleted_at', 'is', null)
        .where('tenants.suspended_at', 'is', null)
        .executeTakeFirst()
    : null;
  const platform = await db
    .selectFrom('platform_admins')
    .select('user_id')
    .where('user_id', '=', session.user_id)
    .executeTakeFirst();
  return {
    userId: session.user_id,
    // Platform accounts never inherit operational access from legacy memberships or support.
    tenantId: platform ? null : (member?.tenant_id ?? null),
    tenantRole: platform ? null : (member?.role ?? null),
    capabilities: platform ? [] : (member?.capabilities ?? []),
    platformAdmin: !!platform,
    ip,
    requestId,
    sessionHash: hash,
    mailboxRoles: new Map(),
  };
}
export async function installAuth(app: FastifyInstance, db: Kysely<DB>, redis: Redis, env: ApiEnv) {
  app.decorateRequest('ctx', null);
  app.addHook('onRequest', async (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      let origin = req.headers.origin;
      try {
        if (!origin && req.headers.referer) origin = new URL(req.headers.referer).origin;
      } catch {
        origin = undefined;
      }
      const accepted = [
        new URL(env.APP_URL).origin,
        ...(env.NODE_ENV === 'development' ? ['http://localhost:5173'] : []),
      ];
      if (!origin || !accepted.includes(origin))
        throw new ApiError(403, 'forbidden', 'Origem da requisição não autorizada.');
    }
    const signed = req.cookies.apmail_session;
    if (signed) {
      const unsigned = app.unsignCookie(signed);
      if (unsigned.valid && unsigned.value)
        req.ctx = await contextForToken(db, redis, unsigned.value, req.ip, req.id);
    }
  });
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0] ?? '';
    if (
      req.ctx?.platformAdmin &&
      !path.startsWith('/api/superadmin/') &&
      !path.startsWith('/api/auth/') &&
      path !== '/api/me' &&
      path !== '/api/preferences' &&
      !path.startsWith('/api/preferences/tables/') &&
      path !== '/api/health'
    )
      throw new ApiError(
        403,
        'platform_only',
        'O superadmin atua somente na gestão da plataforma.',
      );
  });
}
export async function createSession(
  db: Kysely<DB>,
  env: ApiEnv,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
) {
  const token = newToken();
  await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + env.SESSION_TTL_DAYS * 86400000),
      ip: req.ip,
      user_agent: req.headers['user-agent'] ?? null,
    })
    .execute();
  reply.setCookie('apmail_session', token, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86400,
  });
}
export async function invalidateSessions(
  db: Kysely<DB>,
  redis: Redis,
  userId: string,
  exceptHash?: string,
) {
  let query = db.deleteFrom('sessions').where('user_id', '=', userId);
  if (exceptHash) query = query.where('token_hash', '!=', exceptHash);
  const rows = await query.returning('token_hash').execute();
  if (rows.length) await redis.del(...rows.map((r) => 'session:' + r.token_hash));
}
