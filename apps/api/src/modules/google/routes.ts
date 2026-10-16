import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'kysely';
import {
  decryptSecret,
  encryptSecret,
  googleAccessToken,
  getMeetPreferences,
  storeMeetSpace,
  GoogleApiError,
} from '@apmail/db';
import {
  googleMeetUrl,
  GOOGLE_MEET_READ_SCOPE,
  GOOGLE_DRIVE_MEET_SCOPE,
  meetConfigSchema,
  defaultMeetConfig,
  meetCapabilitiesSchema,
} from '@apmail/shared';
import { requireTenant, ApiError, conflict } from '../../authz/context.js';
import type { Resources } from '../resources.js';
import { GoogleClient, GOOGLE_MEET_SCOPE, GOOGLE_CALENDAR_SCOPE } from './client.js';
const secretSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional() });
const stateSchema = z.object({
  user: z.uuid(),
  tenant: z.uuid(),
  session: z.string(),
  verifier: z.string(),
  calendar: z.boolean(),
  reports: z.boolean().default(false),
});
export async function registerGoogleIntegrations(
  app: FastifyInstance,
  r: Resources,
  google = new GoogleClient(),
) {
  const redirectUri = new URL('/api/integrations/google/callback', r.env.APP_URL).href;
  const configured = () => !!(r.env.GOOGLE_CLIENT_ID && r.env.GOOGLE_CLIENT_SECRET);
  const connection = async (c: ReturnType<typeof requireTenant>) =>
    r.db
      .selectFrom('google_connections')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
  const access = (c: ReturnType<typeof requireTenant>, scope: string) =>
    googleAccessToken(r.db, r.env, c, scope, google);
  app.get('/api/integrations/google', async (req) => {
    const c = requireTenant(req.ctx),
      row = await connection(c);
    const pref = await r.db
      .selectFrom('google_meet_preferences')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    const lastSync = await r.db
      .selectFrom('google_meet_spaces')
      .select(['last_sync_at', 'sync_status', 'sync_error'])
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .orderBy(sql`coalesce(last_sync_at,created_at)`, 'desc')
      .executeTakeFirst();
    return {
      configured: configured(),
      redirect_uri: redirectUri,
      connected: !!row,
      email: row?.email ?? null,
      meet: !!row?.scopes.includes(GOOGLE_MEET_SCOPE),
      calendar: !!row?.scopes.includes(GOOGLE_CALENDAR_SCOPE),
      scopes: row?.scopes ?? [],
      preferences: await getMeetPreferences(r.db, c.tenantId, c.userId),
      capabilities: meetCapabilitiesSchema.safeParse(pref?.capabilities ?? {}).data ?? {},
      last_check: pref?.last_check_at?.toISOString() ?? null,
      last_sync: lastSync
        ? {
            at: lastSync.last_sync_at?.toISOString() ?? null,
            status: lastSync.sync_status,
            message: lastSync.sync_error,
          }
        : null,
    };
  });
  app.post('/api/integrations/google/connect', async (req) => {
    const c = requireTenant(req.ctx),
      body = z
        .object({
          calendar: z.boolean().default(false),
          reports: z.boolean().default(false),
          drive: z.boolean().default(false),
        })
        .parse(req.body);
    if (!configured())
      throw conflict('O administrador precisa configurar o aplicativo Google no servidor.');
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(48).toString('base64url');
    await r.redis.set(
      'google-oauth:' + state,
      JSON.stringify({
        user: c.userId,
        tenant: c.tenantId,
        session: c.sessionHash,
        verifier,
        calendar: body.calendar,
        reports: body.reports,
      }),
      'EX',
      600,
    );
    const scopes = [
      'openid',
      'email',
      GOOGLE_MEET_SCOPE,
      ...(body.calendar ? [GOOGLE_CALENDAR_SCOPE] : []),
      ...(body.reports ? [GOOGLE_MEET_READ_SCOPE] : []),
      ...(body.drive ? [GOOGLE_DRIVE_MEET_SCOPE] : []),
    ];
    const query = new URLSearchParams({
      client_id: r.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + query };
  });
  app.get('/api/integrations/google/callback', { logLevel: 'silent' }, async (req, reply) => {
    const c = requireTenant(req.ctx),
      query = z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().max(4096).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query);
    const pending = await r.redis.get('google-oauth:' + query.state);
    if (!pending) throw conflict('A autorização expirou ou já foi utilizada. Conecte novamente.');
    const state = stateSchema.parse(JSON.parse(pending));
    if (state.user !== c.userId || state.tenant !== c.tenantId || state.session !== c.sessionHash)
      throw new ApiError(403, 'forbidden', 'Esta autorização pertence a outra sessão.');
    if (!(await r.redis.getdel('google-oauth:' + query.state)))
      throw conflict('Esta autorização já foi utilizada.');
    const target = new URL('/settings/integrations', r.env.APP_URL);
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (query.error || !query.code) {
      target.searchParams.set('google', 'cancelled');
      return reply.redirect(target.href);
    }
    try {
      const token = await google.token(
          new URLSearchParams({
            client_id: r.env.GOOGLE_CLIENT_ID,
            client_secret: r.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            code: query.code,
            grant_type: 'authorization_code',
            code_verifier: state.verifier,
          }),
        ),
        profile = await google.profile(token.access_token);
      if (!profile.email_verified)
        throw conflict('Confirme o e-mail da conta Google antes de conectar.');
      const old = await connection(c),
        previous =
          old && old.google_subject === profile.sub
            ? secretSchema.parse(
                JSON.parse(decryptSecret(old.encrypted_tokens, r.env.CREDENTIALS_ENCRYPTION_KEY)),
              )
            : null;
      const refresh = token.refresh_token ?? previous?.refresh_token;
      if (!refresh)
        throw conflict(
          'O Google não concedeu acesso offline. Reconecte autorizando o acesso solicitado.',
        );
      const scopes = token.scope.split(' ').filter(Boolean);
      if (!scopes.includes(GOOGLE_MEET_SCOPE))
        throw conflict('A permissão para criar reuniões não foi concedida.');
      const values = {
        google_subject: profile.sub,
        email: profile.email,
        scopes,
        encrypted_tokens: encryptSecret(
          JSON.stringify({ access_token: token.access_token, refresh_token: refresh }),
          r.env.CREDENTIALS_ENCRYPTION_KEY,
        ),
        expires_at: new Date(Date.now() + token.expires_in * 1000),
        updated_at: new Date(),
      };
      await r.db.transaction().execute(async (tx) => {
        if (old && old.google_subject !== profile.sub) {
          await tx.deleteFrom('google_meet_spaces').where('connection_id', '=', old.id).execute();
          await tx
            .updateTable('google_meet_preferences')
            .set({
              capabilities: {},
              last_check_at: null,
              sync_enabled: false,
              artifacts_consent: false,
              consented_at: null,
            })
            .where('tenant_id', '=', c.tenantId)
            .where('user_id', '=', c.userId)
            .execute();
        }
        await tx
          .insertInto('google_connections')
          .values({ ...values, tenant_id: c.tenantId, user_id: c.userId })
          .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet(values))
          .execute();
      });
      target.searchParams.set('google', 'connected');
    } catch {
      target.searchParams.set('google', 'failed');
      app.log.warn({ user_id: c.userId }, 'Não foi possível concluir a autorização Google.');
    }
    return reply.redirect(target.href);
  });
  app.delete('/api/integrations/google', async (req) => {
    const c = requireTenant(req.ctx),
      row = await connection(c);
    if (row) {
      const token = secretSchema.parse(
        JSON.parse(decryptSecret(row.encrypted_tokens, r.env.CREDENTIALS_ENCRYPTION_KEY)),
      );
      await google
        .revoke(token.refresh_token ?? token.access_token)
        .catch(() => app.log.warn('Revogação Google indisponível; acesso local removido.'));
      await r.db.deleteFrom('google_connections').where('id', '=', row.id).execute();
      await r.db
        .updateTable('google_meet_preferences')
        .set({
          sync_enabled: false,
          artifacts_consent: false,
          consented_at: null,
          capabilities: {},
          last_check_at: null,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .execute();
    }
    return { ok: true };
  });
  app.post('/api/integrations/google/meet', async (req) => {
    const c = requireTenant(req.ctx),
      body = z
        .object({ request_id: z.uuid(), config: meetConfigSchema.optional() })
        .parse(req.body);
    const token = await access(c, GOOGLE_MEET_SCOPE);
    const inserted = await r.db
      .insertInto('google_meeting_requests')
      .values({ id: body.request_id, tenant_id: c.tenantId, user_id: c.userId, status: 'pending' })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) {
      const old = await r.db
        .selectFrom('google_meeting_requests')
        .selectAll()
        .where('id', '=', body.request_id)
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .executeTakeFirst();
      if (old?.status === 'completed') return { meeting_url: old.meeting_url };
      throw conflict(
        'Esta solicitação já foi processada ou está em andamento. Verifique o resultado antes de gerar outra sala.',
      );
    }
    try {
      const preferences = await getMeetPreferences(r.db, c.tenantId, c.userId);
      const space = await google.meeting(token, body.config ?? defaultMeetConfig(preferences)),
        url = googleMeetUrl(space.meetingUri);
      if (!url)
        throw new ApiError(502, 'google_error', 'O Google retornou um link de reunião inválido.');
      const owner = await connection(c);
      if (!owner) throw conflict('A conexão Google foi removida. Conecte novamente.');
      const saved = await storeMeetSpace(r.db, owner, space, true);
      await r.db
        .updateTable('google_meeting_requests')
        .set({ status: 'completed', meeting_url: url, space_name: space.name })
        .where('id', '=', body.request_id)
        .execute();
      return { meeting_url: url, space_id: saved.id, space_name: saved.resource_name };
    } catch (error) {
      await r.db
        .updateTable('google_meeting_requests')
        .set({
          status:
            (error instanceof ApiError || error instanceof GoogleApiError) &&
            error.code !== 'google_timeout'
              ? 'failed'
              : 'uncertain',
        })
        .where('id', '=', body.request_id)
        .execute();
      throw error;
    }
  });
  // Read-only preview uses a separate, optional consent. It does not claim bidirectional sync.
  app.get('/api/integrations/google/calendar/events', async (req) => {
    const c = requireTenant(req.ctx),
      token = await access(c, GOOGLE_CALENDAR_SCOPE);
    const query = new URLSearchParams({
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 90 * 86400000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });
    const result = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string(),
              summary: z.string().optional(),
              htmlLink: z.url().optional(),
              start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
              end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
            }),
          )
          .default([]),
      })
      .parse(
        await google.json(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + query,
          { headers: { authorization: 'Bearer ' + token } },
        ),
      );
    return result.items;
  });
}
