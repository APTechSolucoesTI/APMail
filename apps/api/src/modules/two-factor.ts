import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Transaction, Selectable } from 'kysely';
import { verify } from '@node-rs/argon2';
import QRCode from 'qrcode';
import { z } from 'zod';
import { audit, type DB } from '@apmail/db';
import { ApiError, requireAuth } from '../authz/context.js';
import { assertLoginAccessSchedule } from '../authz/access-schedule.js';
import { createSession, hashToken, invalidateSessions, newToken } from '../plugins/auth.js';
import {
  authenticator,
  newAuthenticatorSecret,
  protectAuthenticator,
  readAuthenticator,
  validAuthenticatorStep,
  findRecoveryCode,
  newRecoveryCodes,
} from '../lib/totp.js';
import type { Resources } from './resources.js';

const passwordInput = z.object({ password: z.string().min(1).max(256) });
const proofInput = passwordInput.extend({ code: z.string().trim().min(6).max(32) });
type Factor = Selectable<DB['user_two_factor']>;
const failure = () =>
  new ApiError(
    401,
    'invalid_two_factor',
    'Código inválido ou já utilizado. Aguarde o próximo código ou use um código de recuperação.',
  );
const expired = () =>
  new ApiError(
    401,
    'two_factor_expired',
    'Esta verificação expirou. Entre novamente com seu e-mail e senha.',
  );

async function throttle(r: Resources, userId: string, purpose: 'login' | 'manage') {
  const key = 'auth-mfa:' + purpose + ':' + hashToken(userId);
  const count = await r.redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
    1,
    key,
    900,
  );
  if (Number(count) > 10)
    throw new ApiError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos.');
}
async function lockedUser(tx: Transaction<DB>, userId: string, password: string) {
  const user = await tx
    .selectFrom('users')
    .select(['id', 'email', 'password_hash'])
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!(await verify(user.password_hash, password).catch(() => false)))
    throw new ApiError(400, 'invalid_password', 'Senha atual incorreta.');
  return user;
}
async function securityAudit(r: Resources, userId: string, action: string, ip: string) {
  const platform = await r.db
    .selectFrom('platform_admins')
    .select('user_id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (platform) {
    await r.db.insertInto('platform_audit').values({ actor_id: userId, action }).execute();
    return;
  }
  const memberships = await r.db
    .selectFrom('tenant_members')
    .select('tenant_id')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();
  for (const m of memberships)
    await audit(r.db, {
      tenantId: m.tenant_id,
      actorId: userId,
      action,
      entityType: 'user',
      entityId: userId,
      ip,
    });
}
async function revokeOtherSessions(r: Resources, userId: string, currentHash: string) {
  await invalidateSessions(r.db, r.redis, userId, currentHash);
  const sockets = await r.io.in('user:' + userId).fetchSockets();
  for (const socket of sockets)
    if (!socket.rooms.has('session:' + currentHash)) socket.disconnect(true);
}
function proof(factor: Factor, code: string, key: string) {
  if (!factor.enabled_at || !factor.encrypted_secret) return null;
  const secret = readAuthenticator(factor.encrypted_secret, factor.user_id, key);
  const step = validAuthenticatorStep(secret, code, factor.last_used_step);
  if (step !== null) return { last_used_step: String(step) };
  const index = findRecoveryCode(factor.user_id, code, factor.recovery_code_hashes);
  return index < 0
    ? null
    : {
        recovery_code_hashes: factor.recovery_code_hashes.filter((_hash, i) => i !== index),
      };
}

/** The password row is locked again so enrollment and password changes cannot race login. */
export async function completePasswordLogin(
  r: Resources,
  userId: string,
  verifiedHash: string,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  return r.db.transaction().execute(async (tx) => {
    const user = await tx
      .selectFrom('users')
      .select(['id', 'email', 'full_name', 'password_hash'])
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (user.password_hash !== verifiedHash)
      throw new ApiError(401, 'unauthenticated', 'Entre novamente com sua senha atual.');
    await assertLoginAccessSchedule(tx, userId);
    const factor = await tx
      .selectFrom('user_two_factor')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (factor?.enabled_at) {
      const challenge = newToken(),
        expiresAt = new Date(Date.now() + 5 * 60000);
      // Keep only a bounded set even when a valid password is repeatedly submitted.
      await tx.deleteFrom('auth_two_factor_challenges').where('user_id', '=', userId).execute();
      await tx
        .insertInto('auth_two_factor_challenges')
        .values({
          token_hash: hashToken(challenge),
          user_id: userId,
          factor_version: factor.version,
          password_fingerprint: hashToken(user.password_hash),
          expires_at: expiresAt,
        })
        .execute();
      reply.header('Cache-Control', 'no-store');
      return { requires_two_factor: true as const, challenge, expires_at: expiresAt.toISOString() };
    }
    await tx
      .updateTable('users')
      .set({ last_login_at: new Date() })
      .where('id', '=', userId)
      .execute();
    await createSession(tx, r.env, req, reply, userId);
    return {
      requires_two_factor: false as const,
      user: { id: user.id, email: user.email, full_name: user.full_name },
    };
  });
}

export async function registerTwoFactorRoutes(app: FastifyInstance, r: Resources) {
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/auth/two-factor')) reply.header('Cache-Control', 'no-store');
  });
  const sensitive = {
    logLevel: 'silent' as const,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };
  app.get('/api/auth/two-factor', async (req) => {
    const c = requireAuth(req.ctx);
    const factor = await r.db
      .selectFrom('user_two_factor')
      .select(['enabled_at', 'recovery_code_hashes'])
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    return {
      enabled: !!factor?.enabled_at,
      enabled_at: factor?.enabled_at ?? null,
      recovery_codes_remaining: factor?.enabled_at ? factor.recovery_code_hashes.length : 0,
    };
  });
  app.post('/api/auth/two-factor/setup', sensitive, async (req) => {
    const c = requireAuth(req.ctx),
      b = passwordInput.parse(req.body);
    await throttle(r, c.userId, 'manage');
    const secret = newAuthenticatorSecret(),
      expiresAt = new Date(Date.now() + 10 * 60000);
    const email = await r.db.transaction().execute(async (tx) => {
      const user = await lockedUser(tx, c.userId, b.password);
      const existing = await tx
        .selectFrom('user_two_factor')
        .select('enabled_at')
        .where('user_id', '=', c.userId)
        .executeTakeFirst();
      if (existing?.enabled_at)
        throw new ApiError(409, 'already_enabled', 'O 2FA já está ativo nesta conta.');
      const pending = {
        pending_encrypted_secret: protectAuthenticator(
          secret,
          c.userId,
          r.env.CREDENTIALS_ENCRYPTION_KEY,
        ),
        pending_expires_at: expiresAt,
      };
      await tx
        .insertInto('user_two_factor')
        .values({ user_id: c.userId, ...pending })
        .onConflict((oc) => oc.column('user_id').doUpdateSet(pending))
        .execute();
      return user.email;
    });
    const qrCode = await QRCode.toDataURL(authenticator(secret, email).toString(), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 224,
    });
    return { manual_key: secret, qr_code: qrCode, expires_at: expiresAt.toISOString() };
  });
  app.delete('/api/auth/two-factor/setup', sensitive, async (req) => {
    const c = requireAuth(req.ctx);
    await r.db
      .updateTable('user_two_factor')
      .set({ pending_encrypted_secret: null, pending_expires_at: null })
      .where('user_id', '=', c.userId)
      .execute();
    return { ok: true };
  });
  app.post('/api/auth/two-factor/enable', sensitive, async (req) => {
    const c = requireAuth(req.ctx),
      { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    await throttle(r, c.userId, 'manage');
    const recovery = newRecoveryCodes(c.userId);
    await r.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', c.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const factor = await tx
        .selectFrom('user_two_factor')
        .selectAll()
        .where('user_id', '=', c.userId)
        .forUpdate()
        .executeTakeFirst();
      if (factor?.enabled_at)
        throw new ApiError(409, 'already_enabled', 'O 2FA já está ativo nesta conta.');
      if (
        !factor?.pending_encrypted_secret ||
        !factor.pending_expires_at ||
        factor.pending_expires_at <= new Date()
      )
        throw new ApiError(
          409,
          'setup_expired',
          'A configuração expirou. Inicie novamente para gerar outro QR Code.',
        );
      const secret = readAuthenticator(
        factor.pending_encrypted_secret,
        c.userId,
        r.env.CREDENTIALS_ENCRYPTION_KEY,
      );
      const step = validAuthenticatorStep(secret, code, -1);
      if (step === null) throw failure();
      await tx
        .updateTable('user_two_factor')
        .set({
          encrypted_secret: factor.pending_encrypted_secret,
          enabled_at: new Date(),
          pending_encrypted_secret: null,
          pending_expires_at: null,
          last_used_step: String(step),
          recovery_code_hashes: recovery.hashes,
          version: randomUUID(),
        })
        .where('user_id', '=', c.userId)
        .execute();
      await tx.deleteFrom('auth_two_factor_challenges').where('user_id', '=', c.userId).execute();
      // Revocation is part of enrollment, so old password-only sessions cannot survive it.
      await tx
        .deleteFrom('sessions')
        .where('user_id', '=', c.userId)
        .where('token_hash', '!=', c.sessionHash)
        .execute();
    });
    await revokeOtherSessions(r, c.userId, c.sessionHash);
    await securityAudit(r, c.userId, 'auth.two_factor_enabled', c.ip);
    return { enabled: true, recovery_codes: recovery.codes };
  });
  for (const action of ['disable', 'recovery-codes'] as const) {
    app.post('/api/auth/two-factor/' + action, sensitive, async (req) => {
      const c = requireAuth(req.ctx),
        b = proofInput.parse(req.body);
      await throttle(r, c.userId, 'manage');
      const recovery = newRecoveryCodes(c.userId);
      await r.db.transaction().execute(async (tx) => {
        await lockedUser(tx, c.userId, b.password);
        const factor = await tx
          .selectFrom('user_two_factor')
          .selectAll()
          .where('user_id', '=', c.userId)
          .forUpdate()
          .executeTakeFirst();
        const consumed = factor && proof(factor, b.code, r.env.CREDENTIALS_ENCRYPTION_KEY);
        if (!consumed) throw failure();
        if (action === 'disable')
          await tx.deleteFrom('user_two_factor').where('user_id', '=', c.userId).execute();
        else
          await tx
            .updateTable('user_two_factor')
            .set({ ...consumed, recovery_code_hashes: recovery.hashes, version: randomUUID() })
            .where('user_id', '=', c.userId)
            .execute();
        await tx.deleteFrom('auth_two_factor_challenges').where('user_id', '=', c.userId).execute();
        await tx
          .deleteFrom('sessions')
          .where('user_id', '=', c.userId)
          .where('token_hash', '!=', c.sessionHash)
          .execute();
      });
      await revokeOtherSessions(r, c.userId, c.sessionHash);
      await securityAudit(
        r,
        c.userId,
        action === 'disable' ? 'auth.two_factor_disabled' : 'auth.recovery_codes_regenerated',
        c.ip,
      );
      return action === 'disable' ? { enabled: false } : { recovery_codes: recovery.codes };
    });
  }
  app.post('/api/auth/two-factor/login', sensitive, async (req, reply) => {
    const b = z
      .object({ challenge: z.string().min(30).max(100), code: z.string().trim().min(6).max(32) })
      .parse(req.body);
    const hash = hashToken(b.challenge);
    const initial = await r.db
      .selectFrom('auth_two_factor_challenges')
      .select('user_id')
      .where('token_hash', '=', hash)
      .executeTakeFirst();
    if (!initial) throw expired();
    await throttle(r, initial.user_id, 'login');
    const outcome = await r.db.transaction().execute(async (tx) => {
      const user = await tx
        .selectFrom('users')
        .select(['id', 'email', 'full_name', 'password_hash'])
        .where('id', '=', initial.user_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const factor = await tx
        .selectFrom('user_two_factor')
        .selectAll()
        .where('user_id', '=', user.id)
        .forUpdate()
        .executeTakeFirst();
      const challenge = await tx
        .selectFrom('auth_two_factor_challenges')
        .selectAll()
        .where('token_hash', '=', hash)
        .forUpdate()
        .executeTakeFirst();
      if (
        !challenge ||
        challenge.expires_at <= new Date() ||
        challenge.attempts >= 5 ||
        !factor?.enabled_at ||
        challenge.factor_version !== factor.version ||
        challenge.password_fingerprint !== hashToken(user.password_hash)
      )
        return { kind: 'expired' as const };
      const consumed = proof(factor, b.code, r.env.CREDENTIALS_ENCRYPTION_KEY);
      if (!consumed) {
        await tx
          .updateTable('auth_two_factor_challenges')
          .set({ attempts: challenge.attempts + 1 })
          .where('token_hash', '=', hash)
          .execute();
        return { kind: 'invalid' as const };
      }
      await tx
        .updateTable('user_two_factor')
        .set(consumed)
        .where('user_id', '=', user.id)
        .execute();
      await tx.deleteFrom('auth_two_factor_challenges').where('token_hash', '=', hash).execute();
      await tx
        .updateTable('users')
        .set({ last_login_at: new Date() })
        .where('id', '=', user.id)
        .execute();
      await createSession(tx, r.env, req, reply, user.id, factor.version);
      return {
        kind: 'success' as const,
        user: { id: user.id, email: user.email, full_name: user.full_name },
      };
    });
    if (outcome.kind === 'expired') throw expired();
    if (outcome.kind === 'invalid') {
      await securityAudit(r, initial.user_id, 'auth.two_factor_failed', req.ip);
      throw failure();
    }
    await securityAudit(r, outcome.user.id, 'auth.login', req.ip);
    return { user: outcome.user };
  });
}
