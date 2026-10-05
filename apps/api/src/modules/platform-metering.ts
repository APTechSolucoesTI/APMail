import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { z } from 'zod';
import { requestStorageScan, type DB } from '@apmail/db';
import {
  STORAGE_FORMULA_VERSION,
  type MeteringResult,
  type PlatformOverview,
  type MeteredUsage,
  type ResourceSample,
} from '@apmail/shared';
import { requireSuperAdmin, notFound, ApiError } from '../authz/context.js';
import type { Resources } from './resources.js';

const querySchema = z.object({
  scope: z.enum(['tenants', 'mailboxes', 'platform', 'unassigned']).default('tenants'),
  tenant_id: z.uuid().optional(),
  mailbox_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => [10, 20, 30, 50, 100].includes(n))
    .default(10),
  search: z.string().trim().max(200).default(''),
  sort: z
    .enum([
      'name',
      'tenant_name',
      'attributed_bytes',
      'file_bytes',
      'logical_bytes',
      'allocated_bytes',
      'retained_bytes',
      'messages',
      'discrepancies',
      'growth_bytes',
      'last_synced_at',
    ])
    .default('attributed_bytes'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  quality: z
    .string()
    .default('all')
    .refine((v) => v.split(',').every((k) => ['all', 'pending', 'partial', 'verified'].includes(k)))
    .transform((v) => v.split(',')),
  retained: z.enum(['all', 'active', 'retained']).default('all'),
  period: z.enum(['24h', '7d', '30d', '90d', '24mo']).default('30d'),
});
type Query = z.infer<typeof querySchema>;
const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, '24mo': 731 };
const zero: MeteredUsage = {
  logical_bytes: '0',
  body_bytes: '0',
  metadata_bytes: '0',
  file_bytes: '0',
  allocated_bytes: null,
  attributed_bytes: '0',
  retained_bytes: '0',
  files: 0,
  messages: 0,
  discrepancies: 0,
};
async function capacityForecast(db: Kysely<DB>): Promise<PlatformOverview['capacity_forecast']> {
  // Project physical filesystem availability only. Logical payload growth is a different measure.
  const result = (
    await sql<{
      baseline_at: Date;
      measured_at: Date;
      initial_free: string;
      final_free: string;
      sample_days: number;
      capacities: number;
      devices: number;
    }>`
    with points as (
      select measured_at,metrics->'disk'->>'free_bytes' as free,metrics->'disk'->>'total_bytes' as capacity,metrics->'disk'->>'device' as device
      from platform_metric_samples where source='infrastructure' and measured_at>now()-interval '30 days'
        and metrics->'disk'->>'available'='true' and metrics->'disk'->>'device' is not null
    ) select min(measured_at) as baseline_at,max(measured_at) as measured_at,
      (array_agg(free order by measured_at))[1] as initial_free,(array_agg(free order by measured_at desc))[1] as final_free,
      count(distinct measured_at::date)::int as sample_days,count(distinct capacity)::int as capacities,count(distinct device)::int as devices from points`.execute(
      db,
    )
  ).rows[0];
  if (
    !result?.baseline_at ||
    !result.measured_at ||
    result.sample_days < 7 ||
    result.capacities !== 1 ||
    result.devices !== 1 ||
    Date.now() - result.measured_at.getTime() > 15 * 60000
  )
    return null;
  const elapsed = result.measured_at.getTime() - result.baseline_at.getTime();
  if (
    elapsed < 7 * 86400000 ||
    !/^\d+$/.test(result.initial_free) ||
    !/^\d+$/.test(result.final_free)
  )
    return null;
  const growth = BigInt(result.initial_free) - BigInt(result.final_free);
  if (growth <= 0n) return null;
  const daily = (growth * 86400000n) / BigInt(elapsed);
  if (daily <= 0n) return null;
  const remaining = BigInt(result.final_free) / daily;
  if (remaining > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    days_remaining: Number(remaining),
    daily_growth_bytes: String(daily),
    baseline_at: result.baseline_at.toISOString(),
    measured_at: result.measured_at.toISOString(),
  };
}
async function validateScope(db: Kysely<DB>, q: Query) {
  if (
    q.tenant_id &&
    !(await db.selectFrom('tenants').select('id').where('id', '=', q.tenant_id).executeTakeFirst())
  )
    throw notFound();
  if (q.mailbox_id) {
    if (
      !q.tenant_id ||
      !(await db
        .selectFrom('mailboxes')
        .select('id')
        .where('id', '=', q.mailbox_id)
        .where('tenant_id', '=', q.tenant_id)
        .executeTakeFirst())
    )
      throw notFound();
  }
}
async function listUsage(
  db: Kysely<DB>,
  q: Query,
  scanId?: string,
  pageSize = q.pageSize,
): Promise<MeteringResult> {
  const scope = q.scope === 'tenants' ? 'tenant' : q.scope === 'mailboxes' ? 'mailbox' : q.scope;
  const sort = ['name', 'tenant_name', 'last_synced_at'].includes(q.sort)
    ? sql.ref(q.sort)
    : q.sort === 'growth_bytes'
      ? sql`growth_bytes::numeric`
      : sql`(usage->>${q.sort})::numeric`;
  const result = (
    await sql<{
      items: MeteringResult['items'];
      total: number;
      summary: MeteredUsage | null;
      summary_categories: MeteringResult['summary_categories'];
      selected_tenant: MeteringResult['selected_tenant'];
      measured_at: string | null;
      latest_scan: MeteringResult['latest_scan'];
      latest_full_scan: MeteringResult['latest_full_scan'];
    }>`with publication as (
    select id,published_at from storage_scan_runs where ${scanId ? sql`id=${scanId}::uuid` : sql`published_at is not null`} order by published_at desc nulls last limit 1
  ), baseline as (
    select distinct on(scope_id) scope_id,(usage->>'attributed_bytes')::numeric as bytes,measured_at from storage_usage_snapshots
    where scope=${scope} and quality='verified' and formula_version=${STORAGE_FORMULA_VERSION} and measured_at>=now()-make_interval(days=>${days[q.period]})
    ${q.tenant_id ? sql`and tenant_id=${q.tenant_id}::uuid` : sql``} ${q.mailbox_id ? sql`and mailbox_id=${q.mailbox_id}::uuid` : sql``}
    order by scope_id,measured_at
  ), base as (
    select s.scope_id as id,s.tenant_id,s.mailbox_id,s.scope,s.usage,s.categories,s.measured_at,s.formula_version,s.quality,
      coalesce(b.name,t.name,case s.scope when 'platform' then 'Plataforma' else 'Sem atribuição' end) as name,t.name as tenant_name,b.email_address,
      coalesce(b.status::text,case when t.suspended_at is not null then 'suspended' else 'active' end) as status,
      (coalesce(b.deleted_at,t.deleted_at) is not null) as retained_deleted,b.last_synced_at,bl.measured_at as baseline_at,
      case when bl.measured_at<s.measured_at and s.quality='verified' then ((s.usage->>'attributed_bytes')::numeric-bl.bytes)::text else null end as growth_bytes
    from storage_usage_snapshots s join publication p on p.id=s.scan_id left join tenants t on t.id=s.tenant_id left join mailboxes b on b.id=s.mailbox_id left join baseline bl on bl.scope_id=s.scope_id
    where s.scope=${scope} ${q.tenant_id ? sql`and s.tenant_id=${q.tenant_id}::uuid` : sql``} ${q.mailbox_id ? sql`and s.mailbox_id=${q.mailbox_id}::uuid` : sql``}
  ), filtered as (
    select * from base where (unaccent(name) ilike unaccent(${'%' + q.search + '%'}) or unaccent(tenant_name) ilike unaccent(${'%' + q.search + '%'}) or unaccent(email_address) ilike unaccent(${'%' + q.search + '%'}))
      ${q.quality.includes('all') ? sql`` : sql`and quality in (${sql.join(q.quality)})`} ${q.retained === 'all' ? sql`` : sql`and retained_deleted=${q.retained === 'retained'}`}
  ), paged as (select * from filtered order by ${sort} ${q.direction === 'asc' ? sql`asc nulls last` : sql`desc nulls last`},id limit ${pageSize} offset ${(q.page - 1) * pageSize})
  select coalesce((select jsonb_agg((to_jsonb(p)-'usage')||p.usage) from paged p),'[]'::jsonb) as items,
    (select jsonb_build_object('id',s.scope_id,'tenant_id',s.tenant_id,'mailbox_id',null,'scope','tenant','name',t.name,'tenant_name',t.name,'email_address',null,'status',case when t.suspended_at is null then 'active' else 'suspended' end,'retained_deleted',t.deleted_at is not null,'categories',s.categories,'measured_at',s.measured_at,'formula_version',s.formula_version,'quality',s.quality,
      'growth_bytes',case when bl.measured_at<s.measured_at and s.quality='verified' then ((s.usage->>'attributed_bytes')::numeric-(bl.usage->>'attributed_bytes')::numeric)::text else null end,'baseline_at',bl.measured_at)||s.usage
      from storage_usage_snapshots s join publication p on p.id=s.scan_id join tenants t on t.id=s.tenant_id
      left join lateral (select b.usage,b.measured_at from storage_usage_snapshots b where b.scope='tenant' and b.tenant_id=s.tenant_id and b.quality='verified' and b.formula_version=s.formula_version and b.measured_at>=now()-make_interval(days=>${days[q.period]}) order by b.measured_at limit 1) bl on true
      where s.scope='tenant' and s.tenant_id=${q.tenant_id ?? null}::uuid) as selected_tenant,
    coalesce((select jsonb_agg(c) from (select v->>'category' as category,sum((v->>'logical_bytes')::numeric)::text as logical_bytes,sum((v->>'file_bytes')::numeric)::text as file_bytes from filtered f cross join lateral jsonb_array_elements(f.categories) v group by v->>'category' order by v->>'category') c),'[]'::jsonb) as summary_categories,
    (select count(*)::integer from filtered) as total,coalesce((select max(measured_at) from filtered),(select max(s.measured_at) from storage_usage_snapshots s join publication p on p.id=s.scan_id)) as measured_at,
    (select jsonb_build_object('logical_bytes',coalesce(sum((usage->>'logical_bytes')::numeric),0)::text,'body_bytes',coalesce(sum((usage->>'body_bytes')::numeric),0)::text,
      'metadata_bytes',coalesce(sum((usage->>'metadata_bytes')::numeric),0)::text,'file_bytes',coalesce(sum((usage->>'file_bytes')::numeric),0)::text,
      'allocated_bytes',case when bool_and(usage->>'allocated_bytes' is not null) then sum((usage->>'allocated_bytes')::numeric)::text else null end,
      'attributed_bytes',coalesce(sum((usage->>'attributed_bytes')::numeric),0)::text,'retained_bytes',coalesce(sum((usage->>'retained_bytes')::numeric),0)::text,
      'files',coalesce(sum((usage->>'files')::numeric),0),'messages',coalesce(sum((usage->>'messages')::numeric),0),'discrepancies',coalesce(sum((usage->>'discrepancies')::numeric),0)) from filtered) as summary,
    (select jsonb_build_object('id',r.id,'mode',r.mode,'state',r.state,'checked_files',r.checked_files::text,'error_count',r.error_count::text,'created_at',r.created_at,'started_at',r.started_at,'finished_at',r.finished_at) from storage_scan_runs r where mode<>'publish' order by created_at desc limit 1) as latest_scan,
    (select jsonb_build_object('id',r.id,'mode',r.mode,'state',r.state,'checked_files',r.checked_files::text,'error_count',r.error_count::text,'created_at',r.created_at,'started_at',r.started_at,'finished_at',r.finished_at) from storage_scan_runs r where mode='full' order by created_at desc limit 1) as latest_full_scan`.execute(
      db,
    )
  ).rows[0]!;
  return {
    ...result,
    summary: result.summary ?? zero,
    page: q.page,
    pageSize,
    formula_version: STORAGE_FORMULA_VERSION,
    measured_at: result.measured_at ? new Date(result.measured_at).toISOString() : null,
    stale: !result.measured_at || Date.now() - new Date(result.measured_at).getTime() > 15 * 60000,
  };
}

export async function registerPlatformMetering(app: FastifyInstance, r: Resources) {
  app.get('/api/superadmin/metering', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    await validateScope(r.db, q);
    return listUsage(r.db, q);
  });
  app.get('/api/superadmin/metering/history', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    await validateScope(r.db, q);
    const scope = q.mailbox_id
      ? 'mailbox'
      : q.scope === 'platform' || q.scope === 'unassigned'
        ? q.scope
        : 'tenant';
    return (
      await sql`select measured_at,${q.tenant_id ?? 'global'} as scope_id,${scope} as scope,
      sum((usage->>'attributed_bytes')::numeric)::text as attributed_bytes,sum((usage->>'file_bytes')::numeric)::text as file_bytes,sum((usage->>'logical_bytes')::numeric)::text as logical_bytes,
      case when bool_and(quality='verified') then 'verified' when bool_or(quality='partial') then 'partial' else 'pending' end as quality,formula_version
      from storage_usage_snapshots where scope=${scope} and measured_at>=now()-make_interval(days=>${days[q.period]}) and formula_version=${STORAGE_FORMULA_VERSION}
      ${q.tenant_id ? sql`and tenant_id=${q.tenant_id}::uuid` : sql``} ${q.mailbox_id ? sql`and mailbox_id=${q.mailbox_id}::uuid` : sql``}
      group by measured_at,formula_version order by measured_at`.execute(r.db)
    ).rows;
  });
  app.get('/api/superadmin/metering/growth', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    await validateScope(r.db, q);
    return (
      await sql`with points as (
      select scope_id,scope,measured_at,(usage->>'attributed_bytes')::numeric as bytes,
        row_number() over(partition by scope,scope_id order by measured_at) as first,row_number() over(partition by scope,scope_id order by measured_at desc) as last
      from storage_usage_snapshots where scope=${q.scope === 'mailboxes' ? 'mailbox' : 'tenant'} and quality='verified' and formula_version=${STORAGE_FORMULA_VERSION} and measured_at>=now()-make_interval(days=>${days[q.period]}) ${q.tenant_id ? sql`and tenant_id=${q.tenant_id}::uuid` : sql``} ${q.mailbox_id ? sql`and mailbox_id=${q.mailbox_id}::uuid` : sql``}
    ) select p.scope_id as id,coalesce(b.name,t.name) as name,(max(p.bytes) filter(where last=1)-max(p.bytes) filter(where first=1))::text as growth_bytes,
      min(measured_at) as baseline_at,max(measured_at) as measured_at,count(*)::integer as samples
      from points p left join tenants t on t.id=p.scope_id left join mailboxes b on b.id=p.scope_id group by p.scope_id,b.name,t.name
      having count(*)>1 order by (max(p.bytes) filter(where last=1)-max(p.bytes) filter(where first=1)) desc,p.scope_id limit 10`.execute(
        r.db,
      )
    ).rows;
  });
  app.get('/api/superadmin/metering/integrity', async (req) => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    await validateScope(r.db, q);
    const result = (
      await sql`with filtered as (select d.id,d.code,d.tenant_id,d.mailbox_id,t.name as tenant_name,b.name as mailbox_name,d.first_seen_at,d.last_seen_at
      from storage_discrepancies d left join tenants t on t.id=d.tenant_id left join mailboxes b on b.id=d.mailbox_id where resolved_at is null
      ${q.tenant_id ? sql`and d.tenant_id=${q.tenant_id}::uuid` : sql``} ${q.mailbox_id ? sql`and d.mailbox_id=${q.mailbox_id}::uuid` : sql``}
      and (d.code ilike ${'%' + q.search + '%'} or unaccent(t.name) ilike unaccent(${'%' + q.search + '%'})))
      select coalesce((select jsonb_agg(p) from (select * from filtered order by last_seen_at desc,id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}) p),'[]'::jsonb) as items,(select count(*)::integer from filtered) as total`.execute(
        r.db,
      )
    ).rows[0]!;
    return { ...result, page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/superadmin/metering/runs', async (req) => {
    requireSuperAdmin(req.ctx);
    return r.db
      .selectFrom('storage_scan_runs')
      .select([
        'id',
        'mode',
        'state',
        'checked_files',
        'error_count',
        'created_at',
        'started_at',
        'finished_at',
      ])
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
  });
  app.post('/api/superadmin/metering/reconcile', async (req, reply) => {
    const ctx = requireSuperAdmin(req.ctx),
      body = z.object({ mode: z.enum(['full', 'changed']).default('full') }).parse(req.body ?? {});
    const active = await r.db
      .selectFrom('storage_scan_runs')
      .select(['id', 'mode'])
      .where('state', 'in', ['queued', 'running'])
      .where('mode', '!=', 'publish')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (active) {
      // Recover a durable run whose continuation was removed/cancelled. Duplicate execution is safe.
      if (await r.redis.set('apmail:storage:request-limit', ctx.userId, 'EX', 30, 'NX')) {
        await r.queues['storage-metering'].add(
          'resume',
          { mode: active.mode, run_id: active.id },
          {
            jobId: 'storage-resume-' + active.id,
            attempts: 3,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
        await r.db
          .insertInto('platform_audit')
          .values({
            actor_id: ctx.userId,
            action: 'platform.storage_reconciliation_resumed',
            metadata: { run_id: active.id },
          })
          .execute();
      }
      return reply.code(202).send({ id: active.id, already_running: true });
    }
    if (!(await r.redis.set('apmail:storage:request-limit', ctx.userId, 'EX', 30, 'NX')))
      throw new ApiError(429, 'rate_limited', 'Aguarde antes de solicitar outra reconciliação.');
    const id = await requestStorageScan(r.db, body.mode, ctx.userId);
    await r.queues['storage-metering'].add(
      'manual',
      { mode: body.mode, run_id: id },
      { jobId: 'storage-' + id, attempts: 3 },
    );
    await r.db
      .insertInto('platform_audit')
      .values({
        actor_id: ctx.userId,
        action: 'platform.storage_reconciliation_requested',
        metadata: { run_id: id, mode: body.mode },
      })
      .execute();
    return reply.code(202).send({ id, already_running: false });
  });
  app.get('/api/superadmin/metering/export', async (req, reply) => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    await validateScope(r.db, q);
    const stream = new PassThrough();
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="armazenamento.csv"')
      .send(stream);
    const cell = (value: unknown) => {
      const text = String(value ?? '');
      const safe = /^-?\d+$/.test(text) ? text : text.replace(/^\s*[=+@-]/, "'$&");
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const write = async (line: string) => {
      if (stream.destroyed) throw new Error('export_closed');
      if (!stream.write(line)) await once(stream, 'drain');
    };
    try {
      await r.db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (tx) => {
          const latest = await tx
            .selectFrom('storage_scan_runs')
            .select('id')
            .where('published_at', 'is not', null)
            .orderBy('published_at', 'desc')
            .executeTakeFirst();
          await write(
            '\uFEFFNome;Empresa;Escopo;Dados atribuídos (bytes);Arquivos (bytes);Dados lógicos (bytes);Alocados (bytes);Retidos (bytes);Mensagens;Divergências;Qualidade;Medição;Fórmula;Compartilhado lógico (bytes);Compartilhado arquivos (bytes);Retido lógico (bytes);Retido arquivos (bytes);Variação no período (bytes);Medição inicial;Período;Situação;Última sincronização\r\n',
          );
          if (!latest) return;
          for (let page = 1; ; page++) {
            const data = await listUsage(tx, { ...q, page }, latest.id, 1000);
            for (const v of data.items)
              await write(
                [
                  v.name,
                  v.tenant_name,
                  v.scope,
                  v.attributed_bytes,
                  v.file_bytes,
                  v.logical_bytes,
                  v.allocated_bytes,
                  v.retained_bytes,
                  v.messages,
                  v.discrepancies,
                  v.quality,
                  v.measured_at,
                  v.formula_version,
                  v.shared_logical_bytes,
                  v.shared_file_bytes,
                  v.retained_logical_bytes,
                  v.retained_file_bytes,
                  v.growth_bytes,
                  v.baseline_at,
                  q.period,
                  v.status,
                  v.last_synced_at,
                ]
                  .map(cell)
                  .join(';') + '\r\n',
              );
            if (page * 1000 >= data.total) break;
          }
        });
      await r.db
        .insertInto('platform_audit')
        .values({
          actor_id: req.ctx!.userId,
          action: 'platform.storage_exported',
          metadata: {
            scope: q.scope,
            tenant_id: q.tenant_id ?? null,
            mailbox_id: q.mailbox_id ?? null,
            period: q.period,
          },
        })
        .execute();
      stream.end();
    } catch {
      stream.destroy(new Error('Não foi possível concluir a exportação.'));
    }
    return reply;
  });
  app.get('/api/superadmin/dashboard', async (req): Promise<PlatformOverview> => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    await validateScope(r.db, q);
    const counts = (
      await sql<PlatformOverview['counts']>`select
      (select count(*)::int from tenants where deleted_at is null and suspended_at is null) as tenants,(select count(*)::int from tenants where deleted_at is null and suspended_at is not null) as suspended,
      (select count(*)::int from mailboxes where deleted_at is null) as mailboxes,(select count(*)::int from mailboxes where deleted_at is null and status='error') as mailbox_errors,
      (select count(*)::int from mailboxes where deleted_at is null and status<>'active' and status<>'error') as mailbox_pending,
      (select count(distinct m.user_id)::int from tenant_members m join tenants t on t.id=m.tenant_id where m.status='active' and t.deleted_at is null and not exists(select 1 from platform_admins pa where pa.user_id=m.user_id)) as users,
      (select count(*)::int from platform_admins) as platform_admins,
      (select count(*)::int from invitations where accepted_at is null and expires_at>now()) as invitations,
      (select count(*)::int from messages) as messages,
      (select count(*)::int from outbox where status='failed' and updated_at>=now()-make_interval(days=>${days[q.period]})) as failed_sends,
      (select count(*)::int from invitations where delivery_status='failed' and created_at>=now()-make_interval(days=>${days[q.period]})) as failed_invites,
      (select count(*)::int from mailboxes where deleted_at is null and status='active' and (last_synced_at is null or last_synced_at<now()-make_interval(mins=>${r.env.SYNC_DELAY_MINUTES}))) as sync_delayed`.execute(
        r.db,
      )
    ).rows[0]!;
    const queues = await Promise.all(
      Object.entries(r.queues).map(async ([name, queue]) => {
        try {
          const c = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
          const oldest = (await queue.getWaiting(0, 0))[0];
          return {
            name,
            waiting: c.waiting ?? 0,
            active: c.active ?? 0,
            delayed: c.delayed ?? 0,
            failed: c.failed ?? 0,
            oldest_waiting_at: oldest?.timestamp ?? null,
          };
        } catch {
          return {
            name,
            waiting: null,
            active: null,
            delayed: null,
            failed: null,
            oldest_waiting_at: null,
          };
        }
      }),
    );
    const resources = (
      await sql<ResourceSample>`select distinct on(source) source,measured_at,metrics from platform_metric_samples order by source,measured_at desc`.execute(
        r.db,
      )
    ).rows;
    const audit = await r.db
      .selectFrom('platform_audit as a')
      .leftJoin('tenants as t', 't.id', 'a.tenant_id')
      .select(['a.id', 'a.action', 'a.created_at', 't.name as tenant_name'])
      .where('a.created_at', '>=', sql<Date>`now()-make_interval(days=>${days[q.period]})`)
      .orderBy('a.created_at', 'desc')
      .limit(10)
      .execute();
    return {
      capacity_forecast: await capacityForecast(r.db),
      thresholds: {
        disk_warning_percent: r.env.DISK_WARNING_PERCENT,
        disk_critical_percent: r.env.DISK_CRITICAL_PERCENT,
        sync_delay_minutes: r.env.SYNC_DELAY_MINUTES,
        heartbeat_seconds: r.env.WORKER_HEARTBEAT_SECONDS,
      },
      counts,
      storage: await listUsage(r.db, { ...q, scope: 'tenants', page: 1 }),
      resources,
      queues,
      worker_heartbeat: await r.redis.get('worker:heartbeat').catch(() => null),
      services: {
        database: 'ok',
        redis: await r.redis
          .ping()
          .then(() => 'ok')
          .catch(() => 'error'),
      },
      audit: audit.map((v) => ({ ...v, created_at: v.created_at.toISOString() })),
    };
  });
}
