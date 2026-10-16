import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  GoogleClient,
  googleAccessToken,
  googleFailure,
  getMeetPreferences,
  storeMeetSpace,
  linkMeetEvent,
  asJson,
} from '@apmail/db';
import {
  GOOGLE_MEET_SCOPE,
  GOOGLE_MEET_READ_SCOPE,
  GOOGLE_CALENDAR_SCOPE,
  meetPreferencesSchema,
  meetConfigSchema,
  meetMemberSchema,
  conferenceSchema,
  googleMeetUrl,
  type MeetCapability,
} from '@apmail/shared';
import type { Resources } from '../resources.js';
import { requireTenant, conflict, notFound } from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';

export async function registerMeetManagement(
  app: FastifyInstance,
  r: Resources,
  google = new GoogleClient(),
) {
  const owned = async (req: import('fastify').FastifyRequest) => {
    const c = requireTenant(req.ctx),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    const space = await r.db
      .selectFrom('google_meet_spaces')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!space) throw notFound();
    return { c, space };
  };
  const queueSpace = async (space: {
    id: string;
    connection_id: string;
    resource_name: string;
  }) => {
    await r.queues['google-meet-sync'].add(
      'space',
      {
        kind: 'space',
        space_id: space.id,
        connection_id: space.connection_id,
        resource: space.resource_name,
        generation: randomUUID(),
      },
      { attempts: 4, backoff: { type: 'exponential', delay: 30000 } },
    );
    await r.db
      .updateTable('google_meet_spaces')
      .set({ sync_status: 'queued', next_sync_at: new Date(Date.now() + 300000) })
      .where('id', '=', space.id)
      .execute();
  };
  app.put('/api/integrations/google/meet/preferences', async (req) => {
    const c = requireTenant(req.ctx),
      body = meetPreferencesSchema.parse(req.body);
    if (body.mailbox_id) await requireMailboxPerm(c, r.db, body.mailbox_id, 'send');
    const old = await r.db
      .selectFrom('google_meet_preferences')
      .select('consented_at')
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    const values = {
      ...body,
      consented_at: body.artifacts_consent ? (old?.consented_at ?? new Date()) : null,
      updated_at: new Date(),
    };
    await r.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('google_meet_preferences')
        .values({ ...values, tenant_id: c.tenantId, user_id: c.userId })
        .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet(values))
        .execute();
      if (!body.artifacts_consent)
        await tx
          .deleteFrom('google_meet_records')
          .where(
            'space_id',
            'in',
            tx
              .selectFrom('google_meet_spaces')
              .select('id')
              .where('tenant_id', '=', c.tenantId)
              .where('user_id', '=', c.userId),
          )
          .execute();
      if (body.sync_enabled)
        await tx
          .updateTable('google_meet_spaces')
          .set({ next_sync_at: new Date() })
          .where('tenant_id', '=', c.tenantId)
          .where('user_id', '=', c.userId)
          .execute();
    });
    if (body.sync_enabled) await r.queues['google-meet-sync'].add('sweep', { sweep: true });
    return body;
  });
  app.post(
    '/api/integrations/google/test',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req) => {
      const c = requireTenant(req.ctx),
        connection = await r.db
          .selectFrom('google_connections')
          .selectAll()
          .where('tenant_id', '=', c.tenantId)
          .where('user_id', '=', c.userId)
          .executeTakeFirst();
      if (!connection) throw conflict('Conecte uma conta Google primeiro.');
      const capabilities: Record<string, MeetCapability> = {};
      const verify = async (key: string, operation: () => Promise<unknown>) => {
        try {
          await operation();
          capabilities[key] = {
            state: 'available',
            message: 'A consulta foi autorizada pelo Google.',
            source: 'api',
          };
        } catch (e) {
          const result = googleFailure(e);
          capabilities[key] = {
            state:
              result.state === 'configuration_pending' || result.state === 'permission_required'
                ? result.state
                : 'unverified',
            message: result.message,
            source: 'api',
          };
        }
      };
      let token: string | null = null;
      await verify('account', async () => {
        token = await googleAccessToken(
          r.db,
          r.env,
          c,
          [GOOGLE_MEET_SCOPE, GOOGLE_MEET_READ_SCOPE],
          google,
        );
        await google.profile(token);
      });
      capabilities.create = {
        state: connection.scopes.includes(GOOGLE_MEET_SCOPE) ? 'unverified' : 'permission_required',
        message: connection.scopes.includes(GOOGLE_MEET_SCOPE)
          ? 'Permissão concedida. A criação é validada ao adicionar uma sala; este teste não cria reuniões.'
          : 'Autorize a criação de reuniões.',
        source: 'scope',
      };
      capabilities.automatic = {
        state: 'unverified',
        message:
          'A disponibilidade depende do plano, da política e do privilégio do organizador. O Google valida cada alteração.',
        source: 'configuration',
      };
      capabilities.calendar = {
        state: connection.scopes.includes(GOOGLE_CALENDAR_SCOPE)
          ? 'unverified'
          : 'permission_required',
        message: connection.scopes.includes(GOOGLE_CALENDAR_SCOPE)
          ? 'Permissão concedida; use Consultar agenda para verificar os eventos.'
          : 'Google Agenda ainda não autorizado.',
        source: 'scope',
      };
      if (token) {
        let conference: string | undefined;
        await verify('records', async () => {
          const result = await google.page(
            token!,
            'conferenceRecords',
            'conferenceRecords',
            conferenceSchema,
            new URLSearchParams({ pageSize: '1' }),
          );
          conference = result.items[0]?.name;
        });
        const preferences = await getMeetPreferences(r.db, c.tenantId, c.userId);
        for (const key of ['participants', 'recordings', 'transcripts', 'smartNotes']) {
          if (!preferences.artifacts_consent)
            capabilities[key] = {
              state: 'permission_required',
              message: 'Autorize o acesso aos dados de reuniões nas preferências abaixo.',
              source: 'configuration',
            };
          else if (!conference)
            capabilities[key] = {
              state: 'unverified',
              message:
                'É necessária uma conferência acessível para verificar esta consulta. Nenhum plano foi presumido.',
              source: 'api',
            };
          else
            await verify(key, () =>
              google.meet(
                token!,
                conference + '/' + key,
                {},
                new URLSearchParams({ pageSize: '1' }),
              ),
            );
        }
        const space = await r.db
          .selectFrom('google_meet_spaces')
          .select('resource_name')
          .where('connection_id', '=', connection.id)
          .executeTakeFirst();
        if (space)
          await verify('members', () =>
            google.meet(
              token!,
              space.resource_name + '/members',
              {},
              new URLSearchParams({ pageSize: '1' }),
            ),
          );
        else
          capabilities.members = {
            state: 'unverified',
            message: 'Crie ou associe uma sala para verificar seus membros.',
            source: 'api',
          };
      }
      await r.db
        .insertInto('google_meet_preferences')
        .values({
          tenant_id: c.tenantId,
          user_id: c.userId,
          capabilities: asJson(capabilities),
          last_check_at: new Date(),
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'user_id'])
            .doUpdateSet({ capabilities: asJson(capabilities), last_check_at: new Date() }),
        )
        .execute();
      return { capabilities, checked_at: new Date().toISOString() };
    },
  );
  app.post('/api/integrations/google/meet/associate', async (req) => {
    const c = requireTenant(req.ctx),
      body = z
        .object({ meeting_url: z.string().transform(googleMeetUrl).refine(Boolean) })
        .parse(req.body);
    const connection = await r.db
      .selectFrom('google_connections')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!connection) throw conflict('Conecte sua conta Google.');
    const token = await googleAccessToken(
      r.db,
      r.env,
      c,
      [GOOGLE_MEET_SCOPE, GOOGLE_MEET_READ_SCOPE],
      google,
    );
    const code = body.meeting_url!.split('/').at(-1)!;
    const result = await google.space(token, 'spaces/' + code),
      saved = await storeMeetSpace(r.db, connection, result);
    const events = await r.db
      .selectFrom('calendar_events')
      .select(['id', 'tenant_id', 'user_id', 'meeting_url'])
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('meeting_url', '=', saved.meeting_url)
      .execute();
    for (const event of events) await linkMeetEvent(r.db, event);
    return { space_id: saved.id, space_name: saved.resource_name, meeting_url: saved.meeting_url };
  });
  app.post(
    '/api/integrations/google/sync',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req) => {
      const c = requireTenant(req.ctx),
        preferences = await getMeetPreferences(r.db, c.tenantId, c.userId);
      if (!preferences.sync_enabled || !preferences.artifacts_consent)
        throw conflict('Autorize e ative a sincronização dos dados de reunião em Integrações.');
      const rows = await r.db
        .selectFrom('google_meet_spaces')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .execute();
      for (const space of rows) await queueSpace(space);
      return { queued: rows.length };
    },
  );
  app.post('/api/integrations/google/meet/spaces/:id/sync', async (req) => {
    const { c, space } = await owned(req),
      preferences = await getMeetPreferences(r.db, c.tenantId, c.userId);
    if (!preferences.sync_enabled || !preferences.artifacts_consent)
      throw conflict('Ative a sincronização dos dados de reunião em Integrações.');
    await queueSpace(space);
    return { queued: true };
  });
  app.get('/api/integrations/google/meet/spaces', async (req) => {
    const c = requireTenant(req.ctx),
      { meeting_url } = z
        .object({ meeting_url: z.string().transform(googleMeetUrl).refine(Boolean).optional() })
        .parse(req.query);
    let query = r.db
      .selectFrom('google_meet_spaces')
      .select([
        'id',
        'meeting_url',
        'resource_name',
        'app_created',
        'config',
        'last_sync_at',
        'sync_status',
        'sync_error',
      ])
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId);
    if (meeting_url) query = query.where('meeting_url', '=', meeting_url);
    return query.orderBy('created_at', 'desc').limit(200).execute();
  });
  app.patch('/api/integrations/google/meet/spaces/:id', async (req) => {
    const { c, space } = await owned(req),
      config = meetConfigSchema.parse(req.body);
    const token = await googleAccessToken(r.db, r.env, c, GOOGLE_MEET_SCOPE, google);
    const fields = Object.keys(config)
      .map((key) => 'config.' + key)
      .join(',');
    if (!fields) throw conflict('Escolha uma configuração para alterar.');
    const result = await google.meet(
      token,
      space.resource_name,
      { method: 'PATCH', body: JSON.stringify({ name: space.resource_name, config }) },
      new URLSearchParams({ updateMask: fields }),
    );
    const parsed = z.object({ config: z.record(z.string(), z.unknown()).optional() }).parse(result);
    await r.db
      .updateTable('google_meet_spaces')
      .set({ config: asJson(parsed.config ?? config) })
      .where('id', '=', space.id)
      .execute();
    return { config: parsed.config ?? config };
  });
  app.get('/api/integrations/google/meet/spaces/:id/members', async (req) => {
    const { c, space } = await owned(req),
      { page_token } = z.object({ page_token: z.string().max(8192).optional() }).parse(req.query);
    const token = await googleAccessToken(
      r.db,
      r.env,
      c,
      [GOOGLE_MEET_SCOPE, GOOGLE_MEET_READ_SCOPE],
      google,
    );
    return google.page(
      token,
      space.resource_name + '/members',
      'members',
      meetMemberSchema,
      new URLSearchParams({ pageSize: '100', ...(page_token ? { pageToken: page_token } : {}) }),
    );
  });
  app.post('/api/integrations/google/meet/spaces/:id/members', async (req) => {
    const { c, space } = await owned(req),
      body = z
        .object({ email: z.email(), role: z.enum(['COHOST', 'CONTRIBUTOR', 'VIEWER']) })
        .parse(req.body);
    const token = await googleAccessToken(r.db, r.env, c, GOOGLE_MEET_SCOPE, google);
    return meetMemberSchema.parse(
      await google.meet(token, space.resource_name + '/members', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  });
  app.delete('/api/integrations/google/meet/spaces/:id/members/:member', async (req) => {
    const { c, space } = await owned(req),
      { member } = z
        .object({
          member: z
            .string()
            .regex(/^[\w-]+$/)
            .max(300),
        })
        .parse(req.params);
    const token = await googleAccessToken(r.db, r.env, c, GOOGLE_MEET_SCOPE, google);
    await google.meet(token, space.resource_name + '/members/' + member, { method: 'DELETE' });
    return { ok: true };
  });
}
