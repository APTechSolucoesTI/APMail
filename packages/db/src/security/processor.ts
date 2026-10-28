import { randomUUID } from 'node:crypto';
import { finished as streamFinished } from 'node:stream/promises';
import { sql, type Kysely } from 'kysely';
import type { Queue } from 'bullmq';
import type { DB } from '../types.js';
import type { Storage } from '../storage.js';
import { audit } from '../domain/audit.js';
import { createNotification } from '../domain/notifications.js';
import { probeClamAv, scanClamAv, type ClamAvOptions, type ClamAvScanResult } from './clamav.js';
import type { FileSecurityRow } from './files.js';
import { securityForFiles } from './files.js';
import { applySenderTrust, clearedRelease } from './releases.js';

export const antivirusOptions = (env: {
  CLAMAV_HOST: string;
  CLAMAV_PORT: number;
  CLAMAV_MAX_SCAN_MB: number;
  CLAMAV_SCAN_TIMEOUT_MS: number;
  CLAMAV_CONNECT_TIMEOUT_MS: number;
  CLAMAV_DEFINITIONS_MAX_AGE_HOURS: number;
}): ClamAvOptions => ({
  host: env.CLAMAV_HOST,
  port: env.CLAMAV_PORT,
  maxBytes: env.CLAMAV_MAX_SCAN_MB * 1024 * 1024,
  timeoutMs: env.CLAMAV_SCAN_TIMEOUT_MS,
  connectTimeoutMs: env.CLAMAV_CONNECT_TIMEOUT_MS,
  definitionsMaxAgeHours: env.CLAMAV_DEFINITIONS_MAX_AGE_HOURS,
});
export async function enqueueSecurityScan(
  queue: Queue,
  row: Pick<FileSecurityRow, 'id' | 'generation' | 'status'>,
) {
  if (!['pending', 'error'].includes(row.status)) return;
  await queue.add(
    'scan',
    { id: row.id },
    {
      jobId: `av~${row.id}~${row.generation}`,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    },
  );
}
export async function sweepSecurityFiles(db: Kysely<DB>, queue: Queue, limit = 100) {
  const rows = await db
    .selectFrom('file_security')
    .select(['id', 'generation', 'status'])
    .where('status', 'in', ['pending', 'error'])
    .where('next_attempt_at', '<=', sql<Date>`now()`)
    .where((eb) =>
      eb.or([eb('lease_expires_at', 'is', null), eb('lease_expires_at', '<', sql<Date>`now()`)]),
    )
    .orderBy('next_attempt_at')
    .orderBy('id')
    .limit(Math.min(500, limit))
    .execute();
  for (const row of rows) await enqueueSecurityScan(queue, row);
  return rows.length;
}
const retryDelay = (attempt: number, code: string | null) =>
  ['size_limit', 'definitions_invalid', 'configuration_invalid'].includes(code ?? '')
    ? 86400000
    : [60000, 300000, 1800000, 21600000][Math.min(3, Math.max(0, attempt - 1))]!;
export async function scanSecurityFile(
  db: Kysely<DB>,
  storage: Storage,
  id: string,
  options: ClamAvOptions,
) {
  const lease = randomUUID(),
    now = new Date();
  const row = await db
    .updateTable('file_security')
    .set({
      lease_token: lease,
      lease_expires_at: new Date(Date.now() + Math.max(120000, options.timeoutMs + 30000)),
      attempts: sql`attempts+1`,
      updated_at: now,
    })
    .where('id', '=', id)
    .where('status', 'in', ['pending', 'error'])
    .where('next_attempt_at', '<=', sql<Date>`now()`)
    .where((eb) =>
      eb.or([eb('lease_expires_at', 'is', null), eb('lease_expires_at', '<', sql<Date>`now()`)]),
    )
    .returningAll()
    .executeTakeFirst();
  if (!row) return null;
  let result: ClamAvScanResult;
  try {
    const stat = await storage.inspect(row.storage_key);
    if (!stat) throw new Error('file_missing');
    if (stat.size > BigInt(options.maxBytes)) throw new Error('size_limit');
    const source = await storage.openReadStream(row.storage_key);
    try {
      result = await scanClamAv(source, options);
    } finally {
      source.destroy();
      await streamFinished(source).catch(() => undefined);
    }
    if (result.status === 'error') result.size_bytes = Number(stat.size);
    if (result.status === 'clean' && (!result.sha256 || result.size_bytes !== Number(stat.size)))
      throw new Error('content_changed');
  } catch (error) {
    result = {
      status: 'error',
      sha256: null,
      size_bytes: Number(row.size_bytes),
      threat_name: null,
      error_code:
        error instanceof Error &&
        ['file_missing', 'size_limit', 'content_changed'].includes(error.message)
          ? error.message
          : 'source_error',
      engine_version: null,
      signature_version: null,
      definitions_at: null,
      duration_ms: 0,
    };
  }
  const finished = new Date();
  return db.transaction().execute(async (tx) => {
    const updated = await tx
      .updateTable('file_security')
      .set({
        status: result.status,
        ...(result.status === 'clean' ||
        (result.status === 'infected' &&
          (row.status !== 'infected' || row.threat_name !== result.threat_name))
          ? clearedRelease
          : {}),
        sha256: result.sha256,
        size_bytes: String(result.size_bytes),
        threat_name: result.threat_name?.slice(0, 200) ?? null,
        error_code: result.error_code,
        engine_version: result.engine_version,
        signature_version: result.signature_version,
        definitions_at: result.definitions_at ? new Date(result.definitions_at) : null,
        scanned_at: finished,
        lease_token: null,
        lease_expires_at: null,
        next_attempt_at: new Date(Date.now() + retryDelay(row.attempts, result.error_code)),
        updated_at: finished,
      })
      .where('id', '=', id)
      .where('generation', '=', row.generation)
      .where('lease_token', '=', lease)
      .returningAll()
      .executeTakeFirst();
    if (!updated) return null;
    await tx
      .insertInto('file_scan_history')
      .values({
        file_id: id,
        tenant_id: row.tenant_id,
        mailbox_id: row.mailbox_id,
        user_id: row.user_id,
        message_id: row.message_id,
        filename: row.filename,
        kind: row.kind,
        content_type: row.content_type,
        size_bytes: String(result.size_bytes),
        generation: row.generation,
        attempt: row.attempts,
        status: result.status,
        sha256: result.sha256,
        threat_name: result.threat_name?.slice(0, 200) ?? null,
        error_code: result.error_code,
        engine_version: result.engine_version,
        signature_version: result.signature_version,
        definitions_at: result.definitions_at ? new Date(result.definitions_at) : null,
        duration_ms: Math.min(2147483647, result.duration_ms),
        scanned_at: finished,
      })
      .onConflict((oc) => oc.columns(['file_id', 'generation', 'attempt']).doNothing())
      .execute();
    const effective = await applySenderTrust(tx, updated, storage);
    const allowed = (await securityForFiles(tx, [effective.storage_key])).get(
      effective.storage_key,
    )?.access_allowed;
    if (row.tenant_id && result.status === 'infected' && !allowed) {
      await audit(tx, {
        tenantId: row.tenant_id,
        actorId: null,
        action: 'security.file_quarantined',
        entityType: 'message',
        entityId: row.message_id,
        metadata: { file_id: id, threat: result.threat_name ?? 'Detected', outcome: 'blocked' },
        eventKey: `antivirus:${id}:${row.generation}`,
      });
      const admins = await tx
        .selectFrom('tenant_members')
        .select('user_id')
        .where('tenant_id', '=', row.tenant_id)
        .where('role', 'in', ['owner', 'admin'])
        .where('status', '=', 'active')
        .execute();
      for (const admin of admins)
        await createNotification(tx, {
          tenantId: row.tenant_id,
          userId: admin.user_id,
          type: 'action_failed',
          title: 'Arquivo em quarentena',
          body: 'A proteção de anexos detectou um arquivo com risco. Consulte a Central de Segurança.',
          link: '/security/antivirus',
          payload: { file_id: id },
        });
    }
    return effective;
  });
}
export async function refreshAntivirusHealth(db: Kysely<DB>, options: ClamAvOptions) {
  const previous = await db
    .selectFrom('antivirus_health')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirst();
  if (previous && Date.now() - previous.checked_at.getTime() < 45000) return previous;
  const health = await probeClamAv(options);
  const age = health.definitions_at
    ? (Date.now() - new Date(health.definitions_at).getTime()) / 3600000
    : null;
  const key =
    health.status !== 'online'
      ? (health.error_code ?? health.status)
      : age !== null && age > 48
        ? 'definitions_aging'
        : null;
  return db.transaction().execute(async (tx) => {
    await tx
      .insertInto('antivirus_health')
      .values({ id: 1, status: health.status })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    const current = await tx
      .selectFrom('antivirus_health')
      .selectAll()
      .where('id', '=', 1)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const alert =
      !!key &&
      (key !== current.alert_key ||
        !current.last_alert_at ||
        Date.now() - current.last_alert_at.getTime() > 21600000);
    const updated = await tx
      .updateTable('antivirus_health')
      .set({
        status: health.status,
        engine_version: health.engine_version,
        signature_version: health.signature_version,
        definitions_at: health.definitions_at ? new Date(health.definitions_at) : null,
        checked_at: new Date(health.checked_at),
        error_code: health.error_code,
        alert_key: key,
        ...(alert ? { last_alert_at: new Date() } : {}),
      })
      .where('id', '=', 1)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (alert) {
      const admins = await tx
        .selectFrom('tenant_members as m')
        .innerJoin('tenants as t', 't.id', 'm.tenant_id')
        .select(['m.tenant_id', 'm.user_id'])
        .where('m.role', 'in', ['owner', 'admin'])
        .where('m.status', '=', 'active')
        .where('t.deleted_at', 'is', null)
        .where('t.suspended_at', 'is', null)
        .execute();
      for (const admin of admins)
        await createNotification(tx, {
          tenantId: admin.tenant_id,
          userId: admin.user_id,
          type: 'action_failed',
          title: 'Proteção de anexos requer atenção',
          body:
            key === 'definitions_aging'
              ? 'As definições do antivírus estão envelhecendo. Confira a atualização.'
              : 'O antivírus está indisponível ou não concluiu a verificação. Arquivos não verificados permanecem bloqueados.',
          link: '/security/antivirus',
          payload: { code: key },
        });
    }
    return updated;
  });
}
