import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  registerSecurityFile,
  requestFileRescan,
  enqueueSecurityScan,
  refreshAntivirusHealth,
  antivirusOptions,
  countUnverifiedFiles,
  listUnverifiedFiles,
  unverifiedQuery,
  audit,
  type FileSecurityRow,
  type SecurityFileInput,
} from '@apmail/db';
import { requireTenantAdmin, conflict, notFound } from '../authz/context.js';
import type { Resources } from './resources.js';

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .refine((n) => [10, 20, 30, 50, 100].includes(n))
    .default(10),
  search: z.string().max(200).optional(),
  status: z.enum(['all', 'pending', 'clean', 'infected', 'error']).default('all'),
});
const scope = (
  tenant: string,
  alias = 's',
) => sql<boolean>`(${sql.ref(alias + '.tenant_id')}=${tenant} or
  (${sql.ref(alias + '.tenant_id')} is null and ${sql.ref(alias + '.kind')}='avatar' and exists(
    select 1 from tenant_members tm where tm.user_id=${sql.ref(alias + '.user_id')} and tm.tenant_id=${tenant} and tm.status='active')))`;
const message = (code: string | null) =>
  code === 'size_limit'
    ? 'O arquivo excede o limite de análise do serviço.'
    : code
      ? 'A verificação não foi concluída. O arquivo permanece bloqueado.'
      : null;
export async function registerAntivirus(app: FastifyInstance, r: Resources) {
  const publish = async (row: FileSecurityRow) =>
    enqueueSecurityScan(r.queues['antivirus-scan'], row).catch(() =>
      app.log.warn({ file_id: row.id }, 'Análise persistida; publicação na fila será recuperada.'),
    );
  const prefix = '/api/security/antivirus';
  app.get(prefix + '/overview', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    const [health, totals, unverified] = await Promise.all([
      refreshAntivirusHealth(r.db, antivirusOptions(r.env)),
      sql<{
        status: string;
        n: string;
      }>`select s.status,count(*) as n from file_security s where ${scope(c.tenantId)} group by s.status`.execute(
        r.db,
      ),
      countUnverifiedFiles(r.db, c.tenantId),
    ]);
    const counts = {
      total: unverified,
      pending: unverified,
      clean: 0,
      infected: 0,
      error: 0,
      unverified,
    };
    for (const row of totals.rows) {
      const key = row.status as 'pending' | 'clean' | 'infected' | 'error';
      counts[key] += Number(row.n);
      counts.total += Number(row.n);
    }
    const age = health.definitions_at
      ? (Date.now() - health.definitions_at.getTime()) / 3600000
      : null;
    const stale = Date.now() - health.checked_at.getTime() > 120000 || (age !== null && age > 48);
    return { health: { ...health, stale, age_hours: age }, counts };
  });
  for (const history of [false, true])
    app.get(prefix + (history ? '/history' : '/files'), async (req) => {
      const c = requireTenantAdmin(req.ctx),
        q = schema.parse(req.query);
      const columns = sql`s.id,s.id as file_id,s.tenant_id,s.mailbox_id,s.message_id,s.filename,s.kind,s.content_type,
      s.size_bytes,s.status,s.threat_name,s.scanned_at,s.error_code,s.engine_version,s.signature_version,s.definitions_at`;
      const registered = history
        ? sql`select ${columns},s.scanned_at as created_at,s.scanned_at as updated_at from file_scan_history s where ${scope(c.tenantId)}`
        : sql`select ${columns},s.created_at,s.updated_at from file_security s where ${scope(c.tenantId)}`;
      // History row identifiers are separate from the file identifier used for rescan.
      const source = history
        ? sql`select s.id,s.file_id,s.tenant_id,s.mailbox_id,s.message_id,s.filename,s.kind,s.content_type,
      s.size_bytes,s.status,s.threat_name,s.scanned_at,s.error_code,s.engine_version,s.signature_version,s.definitions_at,
      s.scanned_at as created_at,s.scanned_at as updated_at from file_scan_history s where ${scope(c.tenantId)}`
        : sql`${registered} union all select u.resource_id as id,null::uuid as file_id,u.tenant_id,u.mailbox_id,u.message_id,u.filename,u.kind,u.content_type,
      u.size_bytes,'pending'::text,null::text,null::timestamptz,null::text,null::text,null::text,null::timestamptz,
      null::timestamptz,null::timestamptz from (${unverifiedQuery(c.tenantId)}) u`;
      const filter = sql`where ${q.status === 'all' ? sql`true` : sql`f.status=${q.status}`}
      ${q.search ? sql`and (f.filename ilike ${'%' + q.search + '%'} or f.threat_name ilike ${'%' + q.search + '%'} or m.subject ilike ${'%' + q.search + '%'} or b.name ilike ${'%' + q.search + '%'})` : sql``}`;
      const base = sql`from (${source}) f left join messages m on m.id=f.message_id and m.tenant_id=${c.tenantId}
      left join mailboxes b on b.id=f.mailbox_id and b.tenant_id=${c.tenantId} ${filter}`;
      const total = Number(
        (await sql<{ n: string }>`select count(*) as n ${base}`.execute(r.db)).rows[0]?.n ?? 0,
      );
      const rows = await sql<
        Record<string, unknown>
      >`select f.*,b.name as mailbox_name,b.email_address as mailbox_email,m.thread_id,m.subject as message_subject
      ${base} order by f.updated_at desc nulls last,f.id limit ${q.page_size} offset ${(q.page - 1) * q.page_size}`.execute(
        r.db,
      );
      return {
        items: rows.rows.map((row) => ({
          id: row.id,
          file_id: row.file_id,
          filename: row.filename,
          kind: row.kind,
          content_type: row.content_type,
          size_bytes: Number(row.size_bytes),
          status: row.status,
          threat_name: row.threat_name,
          scanned_at: row.scanned_at,
          error_code: row.error_code,
          error_message: message(row.error_code as string | null),
          engine_version: row.engine_version,
          signature_version: row.signature_version,
          definitions_at: row.definitions_at,
          created_at: row.created_at,
          mailbox: row.mailbox_id
            ? { id: row.mailbox_id, name: row.mailbox_name, email_address: row.mailbox_email }
            : null,
          message: row.message_id
            ? { id: row.message_id, thread_id: row.thread_id, subject: row.message_subject }
            : null,
        })),
        total,
        page: q.page,
        pageSize: q.page_size,
      };
    });
  app.post(prefix + '/files/:id/rescan', async (req) => {
    const c = requireTenantAdmin(req.ctx),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    const result = await r.db.transaction().execute(async (tx) => {
      const old = await tx
        .selectFrom('file_security as s')
        .selectAll('s')
        .where('s.id', '=', id)
        .where(scope(c.tenantId))
        .forUpdate()
        .executeTakeFirst();
      if (old) {
        if (old.lease_expires_at && old.lease_expires_at > new Date())
          throw conflict('Este arquivo já está sendo analisado. Aguarde a conclusão.');
        return requestFileRescan(tx, id, c.tenantId);
      }
      const candidate = (
        await sql<SecurityFileInput>`select * from (${unverifiedQuery(c.tenantId)}) c where c.resource_id=${id} limit 1`.execute(
          tx,
        )
      ).rows[0];
      if (!candidate) throw notFound();
      return registerSecurityFile(tx, candidate);
    });
    if (!result) throw notFound();
    await publish(result);
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'security.file_rescan_requested',
      entityType: 'file_security',
      entityId: result.id,
      metadata: { file_id: result.id },
      ip: c.ip,
    });
    return { ok: true, id: result.id, status: 'pending' };
  });
  app.post(prefix + '/backfill', async (req) => {
    const c = requireTenantAdmin(req.ctx),
      q = z
        .object({
          limit: z.union([z.literal(10), z.literal(50), z.literal(100), z.literal(500)]),
          scope: z.enum(['unverified', 'failed']),
        })
        .parse(req.body);
    const rows: FileSecurityRow[] = [];
    if (q.scope === 'unverified')
      for (const item of await listUnverifiedFiles(r.db, c.tenantId, q.limit))
        rows.push(await registerSecurityFile(r.db, item));
    else
      await r.db.transaction().execute(async (tx) => {
        const found = await tx
          .selectFrom('file_security as s')
          .selectAll('s')
          .where(scope(c.tenantId))
          .where('status', '=', 'error')
          .where((eb) =>
            eb.or([eb('lease_expires_at', 'is', null), eb('lease_expires_at', '<', new Date())]),
          )
          .orderBy('updated_at')
          .limit(q.limit)
          .forUpdate()
          .skipLocked()
          .execute();
        for (const old of found) {
          const row = await requestFileRescan(tx, old.id, c.tenantId);
          if (row) rows.push(row);
        }
      });
    for (const row of rows) await publish(row);
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'security.backfill_requested',
      entityType: 'security',
      metadata: { count: rows.length, scope: q.scope },
      ip: c.ip,
    });
    return { queued: rows.length };
  });
}
