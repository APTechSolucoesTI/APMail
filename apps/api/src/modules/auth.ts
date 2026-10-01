import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { audit } from '@apmail/db';
import {
  signupSchema,
  loginSchema,
  passwordSchema,
  emailSchema,
  fullNameSchema,
  tenantSchema,
  preferencesSchema,
  tableConfigSchema,
} from '@apmail/shared';
import {
  ApiError,
  requireAuth,
  requireTenant,
  notFound,
  type RequestContext,
} from '../authz/context.js';
import { hashToken, newToken, createSession, invalidateSessions } from '../plugins/auth.js';
import type { Resources } from './resources.js';
export const hashPassword = (value: string) =>
  hash(value, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const publicUserColumns = [
  'id',
  'email',
  'full_name',
  'avatar_path',
  'current_tenant_id',
  'updated_at',
] as const;
export const avatarUrl = (user: { id: string; avatar_path: string | null; updated_at: Date }) =>
  user.avatar_path ? `/api/avatars/${user.id}?v=${user.updated_at.getTime()}` : null;
export async function me(ctx: RequestContext, r: Resources) {
  const user = await r.db
    .selectFrom('users')
    .select(publicUserColumns)
    .where('id', '=', ctx.userId)
    .executeTakeFirstOrThrow();
  const tenants = await r.db
    .selectFrom('tenant_members')
    .innerJoin('tenants', 'tenants.id', 'tenant_members.tenant_id')
    .select(['tenants.id', 'tenants.name', 'tenants.slug', 'tenant_members.role'])
    .where('tenant_members.user_id', '=', ctx.userId)
    .where('tenant_members.status', '=', 'active')
    .where('tenants.deleted_at', 'is', null)
    .execute();
  const preferences = await r.db
    .selectFrom('user_preferences')
    .selectAll()
    .where('user_id', '=', ctx.userId)
    .executeTakeFirst();
  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: avatarUrl(user),
    },
    tenants,
    current_tenant_id: ctx.tenantId,
    preferences,
  };
}
async function auditUser(r: Resources, userId: string, action: string, ip: string) {
  const members = await r.db
    .selectFrom('tenant_members')
    .select('tenant_id')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();
  await Promise.all(
    members.map((m) =>
      audit(r.db, {
        tenantId: m.tenant_id,
        actorId: userId,
        action,
        entityType: 'user',
        entityId: userId,
        ip,
      }),
    ),
  );
}
export async function rateByEmail(
  r: Resources,
  key: string,
  email: string,
  max: number,
  seconds: number,
) {
  const k = 'auth-rate:' + key + ':' + hashToken(email);
  const result = await r.redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
    1,
    k,
    seconds,
  );
  if (Number(result) > max)
    throw new ApiError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos.');
}
export async function registerAuthRoutes(app: FastifyInstance, r: Resources) {
  app.post(
    '/api/auth/signup',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!r.env.ALLOW_PUBLIC_SIGNUP)
        throw new ApiError(
          403,
          'forbidden',
          'Cadastro desativado. Peça um convite ao administrador.',
        );
      const b = signupSchema.parse(req.body);
      const user = await r.db.transaction().execute(async (tx) => {
        const u = await tx
          .insertInto('users')
          .values({
            email: b.email,
            full_name: b.full_name,
            password_hash: await hashPassword(b.password),
          })
          .returning(['id', 'email', 'full_name'])
          .executeTakeFirstOrThrow();
        await tx.insertInto('user_preferences').values({ user_id: u.id }).execute();
        return u;
      });
      await createSession(r.db, r.env, req, reply, user.id);
      return reply.code(201).send({ user });
    },
  );
  const dummy = await hashPassword(newToken());
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const b = loginSchema.parse(req.body);
      await rateByEmail(r, 'login', b.email, 5, 900);
      const user = await r.db
        .selectFrom('users')
        .select(['id', 'password_hash'])
        .where('email', '=', b.email)
        .executeTakeFirst();
      const valid = await verify(user?.password_hash ?? dummy, b.password).catch(() => false);
      if (!user || !valid) {
        if (user) await auditUser(r, user.id, 'auth.login_failed', req.ip);
        throw new ApiError(401, 'unauthenticated', 'E-mail ou senha inválidos.');
      }
      await r.redis.del('auth-rate:login:' + hashToken(b.email));
      await r.db
        .updateTable('users')
        .set({ last_login_at: new Date() })
        .where('id', '=', user.id)
        .execute();
      await createSession(r.db, r.env, req, reply, user.id);
      await auditUser(r, user.id, 'auth.login', req.ip);
      return {
        user: await r.db
          .selectFrom('users')
          .select(['id', 'email', 'full_name'])
          .where('id', '=', user.id)
          .executeTakeFirstOrThrow(),
      };
    },
  );
  app.post('/api/auth/logout', async (req, reply) => {
    const c = requireAuth(req.ctx);
    await r.db.deleteFrom('sessions').where('token_hash', '=', c.sessionHash).execute();
    await r.redis.del('session:' + c.sessionHash);
    r.io.in('session:' + c.sessionHash).disconnectSockets(true);
    reply.clearCookie('apmail_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => me(requireAuth(req.ctx), r));
  app.post('/api/auth/forgot-password', async (req) => {
    const b = z.object({ email: emailSchema }).parse(req.body);
    await rateByEmail(r, 'forgot', b.email, 3, 3600);
    const user = await r.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', b.email)
      .executeTakeFirst();
    if (user) {
      const token = newToken();
      await r.db
        .insertInto('password_reset_tokens')
        .values({
          user_id: user.id,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + 3600000),
        })
        .execute();
      await r.queues['system-email'].add(
        'password-reset',
        { to: b.email, data: { link: r.env.APP_URL + '/reset-password?token=' + token } },
        { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true },
      );
    }
    return { ok: true, message: 'Se a conta existir, você receberá instruções por e-mail.' };
  });
  app.post('/api/auth/reset-password', async (req, reply) => {
    const b = z
      .object({ token: z.string().min(30).max(100), password: passwordSchema })
      .parse(req.body);
    const userId = await r.db.transaction().execute(async (tx) => {
      const token = await tx
        .selectFrom('password_reset_tokens')
        .select(['id', 'user_id'])
        .where('token_hash', '=', hashToken(b.token))
        .where('used_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!token)
        throw new ApiError(400, 'validation_error', 'Este link expirou ou já foi utilizado.');
      await tx
        .updateTable('users')
        .set({ password_hash: await hashPassword(b.password) })
        .where('id', '=', token.user_id)
        .execute();
      await tx
        .updateTable('password_reset_tokens')
        .set({ used_at: new Date() })
        .where('user_id', '=', token.user_id)
        .where('used_at', 'is', null)
        .execute();
      return token.user_id;
    });
    await invalidateSessions(r.db, r.redis, userId);
    r.io.in('user:' + userId).disconnectSockets(true);
    await createSession(r.db, r.env, req, reply, userId);
    await auditUser(r, userId, 'auth.password_changed', req.ip);
    return { ok: true };
  });
  app.post('/api/auth/change-password', async (req) => {
    const c = requireAuth(req.ctx);
    const b = z
      .object({ current_password: z.string().max(256), new_password: passwordSchema })
      .parse(req.body);
    const u = await r.db
      .selectFrom('users')
      .select(['email', 'password_hash'])
      .where('id', '=', c.userId)
      .executeTakeFirstOrThrow();
    if (!(await verify(u.password_hash, b.current_password)))
      throw new ApiError(400, 'validation_error', 'Senha atual incorreta.');
    await r.db
      .updateTable('users')
      .set({ password_hash: await hashPassword(b.new_password) })
      .where('id', '=', c.userId)
      .execute();
    await invalidateSessions(r.db, r.redis, c.userId, c.sessionHash);
    const sockets = await r.io.in('user:' + c.userId).fetchSockets();
    for (const s of sockets) if (!s.rooms.has('session:' + c.sessionHash)) s.disconnect(true);
    await r.queues['system-email'].add(
      'password-changed',
      { to: u.email, data: {} },
      { removeOnComplete: true },
    );
    await auditUser(r, c.userId, 'auth.password_changed', req.ip);
    return { ok: true };
  });
  app.patch('/api/me', async (req) => {
    const c = requireAuth(req.ctx);
    const b = z.object({ full_name: fullNameSchema }).parse(req.body);
    await r.db.updateTable('users').set(b).where('id', '=', c.userId).execute();
    return me(c, r);
  });
  app.put('/api/me/current-tenant', async (req) => {
    const c = requireAuth(req.ctx);
    const b = z.object({ tenant_id: z.uuid() }).parse(req.body);
    const m = await r.db
      .selectFrom('tenant_members')
      .select('id')
      .where('user_id', '=', c.userId)
      .where('tenant_id', '=', b.tenant_id)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!m) throw notFound();
    await r.db
      .updateTable('users')
      .set({ current_tenant_id: b.tenant_id })
      .where('id', '=', c.userId)
      .execute();
    r.io.in('user:' + c.userId).disconnectSockets(true);
    return { ok: true };
  });
  app.post('/api/tenants', async (req, reply) => {
    const c = requireAuth(req.ctx);
    const b = tenantSchema.parse(req.body);
    const tenant = await r.db.transaction().execute(async (tx) => {
      const t = await tx.insertInto('tenants').values(b).returningAll().executeTakeFirstOrThrow();
      await tx
        .insertInto('tenant_members')
        .values({ tenant_id: t.id, user_id: c.userId, role: 'owner' })
        .execute();
      await tx
        .updateTable('users')
        .set({ current_tenant_id: t.id })
        .where('id', '=', c.userId)
        .execute();
      return t;
    });
    r.io.in('user:' + c.userId).disconnectSockets(true);
    return reply.code(201).send(tenant);
  });
  app.get('/api/preferences', async (req) => {
    const c = requireAuth(req.ctx);
    return r.db
      .selectFrom('user_preferences')
      .selectAll()
      .where('user_id', '=', c.userId)
      .executeTakeFirstOrThrow();
  });
  app.put('/api/preferences', async (req) => {
    const c = requireAuth(req.ctx);
    const b = preferencesSchema.parse(req.body);
    return r.db
      .updateTable('user_preferences')
      .set(b)
      .where('user_id', '=', c.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  app.get('/api/preferences/tables/:listKey', async (req) => {
    const c = requireAuth(req.ctx);
    const { listKey } = z.object({ listKey: z.string().min(1).max(100) }).parse(req.params);
    return {
      config:
        (
          await r.db
            .selectFrom('table_preferences')
            .select('config')
            .where('user_id', '=', c.userId)
            .where('list_key', '=', listKey)
            .executeTakeFirst()
        )?.config ?? null,
    };
  });
  app.put('/api/preferences/tables/:listKey', async (req) => {
    const c = requireAuth(req.ctx);
    const { listKey } = z.object({ listKey: z.string().min(1).max(100) }).parse(req.params);
    const b = z.object({ config: tableConfigSchema }).parse(req.body);
    await r.db
      .insertInto('table_preferences')
      .values({ user_id: c.userId, list_key: listKey, config: b.config })
      .onConflict((oc) => oc.columns(['user_id', 'list_key']).doUpdateSet({ config: b.config }))
      .execute();
    return b;
  });
  app.get('/api/notifications/unread-count', async (req) => {
    const c = requireTenant(req.ctx);
    const row = await r.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return { count: Number(row.count) };
  });
  app.get('/api/notifications', async (req) => {
    const c = requireTenant(req.ctx);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        before: z.iso.datetime().optional(),
      })
      .parse(req.query);
    let query = r.db
      .selectFrom('notifications')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId);
    if (q.before) query = query.where('created_at', '<', new Date(q.before));
    return query.orderBy('created_at', 'desc').limit(q.limit).execute();
  });
  app.post('/api/notifications/read-all', async (req) => {
    const c = requireTenant(req.ctx);
    await r.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('read_at', 'is', null)
      .execute();
    return { ok: true };
  });
  app.post('/api/notifications/:id/read', async (req) => {
    const c = requireTenant(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const result = await r.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows)) throw notFound();
    return { ok: true };
  });
}
