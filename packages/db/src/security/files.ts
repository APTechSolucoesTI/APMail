import { createHash } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../types.js';
import type { Storage } from '../storage.js';

export type FileSecurityRow = Selectable<DB['file_security']>;
export type FileSecurityStatus = 'pending' | 'clean' | 'infected' | 'error';
export type SecurityFileInput = {
  storage_key: string;
  tenant_id: string | null;
  mailbox_id: string | null;
  user_id?: string | null;
  message_id?: string | null;
  resource_id?: string | null;
  filename: string;
  content_type: string;
  size_bytes: number | string | bigint;
  kind:
    | 'attachment'
    | 'upload'
    | 'signature_image'
    | 'avatar'
    | 'mail_import'
    | 'mail_export'
    | 'mail_raw';
};
export class FileSecurityError extends Error {
  readonly statusCode: number;
  constructor(readonly code: 'file_pending' | 'file_infected' | 'file_scan_error') {
    super(
      code === 'file_infected'
        ? 'Este arquivo está em quarentena por apresentar risco. O acesso foi bloqueado.'
        : code === 'file_pending'
          ? 'Este arquivo aguarda análise de segurança. Tente novamente após a verificação.'
          : 'Não foi possível concluir a análise de segurança deste arquivo. Peça uma nova verificação ao administrador.',
    );
    this.name = 'FileSecurityError';
    this.statusCode = code === 'file_infected' ? 403 : 409;
  }
}
export const isFileSecurityError = (error: unknown): error is FileSecurityError =>
  error instanceof FileSecurityError;
type SecurityEvidence = {
  id: string | null;
  status: string;
  threat_name: string | null;
  scanned_at: Date | string | null;
  error_code: string | null;
  engine_version: string | null;
  definitions_at: Date | string | null;
};
const instant = (value: Date | string | null | undefined) =>
  typeof value === 'string' ? value : (value?.toISOString() ?? null);
export const securitySummary = (row: SecurityEvidence | null | undefined) => ({
  id: row?.id ?? null,
  status: (row?.status ?? 'pending') as FileSecurityStatus,
  threat_name: row?.threat_name ?? null,
  scanned_at: instant(row?.scanned_at),
  error_code: row?.error_code ?? null,
  engine_version: row?.engine_version ?? null,
  definitions_at: instant(row?.definitions_at),
});
export async function securityForFiles(db: Kysely<DB>, paths: string[]) {
  const rows = paths.length
    ? await db
        .selectFrom('file_security')
        .selectAll()
        .where('storage_key', 'in', [...new Set(paths)])
        .execute()
    : [];
  const found = new Map(rows.map((row) => [row.storage_key, row]));
  return new Map(paths.map((path) => [path, securitySummary(found.get(path))]));
}
export async function registerSecurityFile(
  db: Kysely<DB>,
  input: SecurityFileInput,
): Promise<FileSecurityRow> {
  const row = await db
    .insertInto('file_security')
    .values({
      ...input,
      size_bytes: String(input.size_bytes),
      filename: input.filename.slice(0, 512),
      content_type: input.content_type.slice(0, 255),
    })
    .onConflict((oc) => oc.column('storage_key').doNothing())
    .returningAll()
    .executeTakeFirst();
  if (row) return row;
  const existing = await db
    .selectFrom('file_security')
    .selectAll()
    .where('storage_key', '=', input.storage_key)
    .executeTakeFirstOrThrow();
  if (
    existing.tenant_id !== input.tenant_id ||
    existing.mailbox_id !== input.mailbox_id ||
    (input.user_id && existing.user_id && existing.user_id !== input.user_id)
  )
    throw new Error('file_security_scope_mismatch');
  return existing;
}
export async function requestFileRescan(db: Kysely<DB>, id: string, tenantId: string) {
  return db
    .updateTable('file_security')
    .set({
      status: 'pending',
      generation: sql`generation+1`,
      attempts: 0,
      sha256: null,
      threat_name: null,
      error_code: null,
      scanned_at: null,
      next_attempt_at: new Date(),
      lease_token: null,
      lease_expires_at: null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where((eb) =>
      eb.or([
        eb('tenant_id', '=', tenantId),
        eb.and([
          eb('tenant_id', 'is', null),
          eb('kind', '=', 'avatar'),
          eb(
            'user_id',
            'in',
            db.selectFrom('tenant_members').select('user_id').where('tenant_id', '=', tenantId),
          ),
        ]),
      ]),
    )
    .returningAll()
    .executeTakeFirst();
}
/** Cached AV verdicts are reused. Optional integrity check hashes bytes, never invokes ClamAV. */
export async function assertFilesClean(db: Kysely<DB>, paths: string[], storage?: Storage) {
  if (!paths.length) return;
  const rows = await db
    .selectFrom('file_security')
    .selectAll()
    .where('storage_key', 'in', [...new Set(paths)])
    .execute();
  const byPath = new Map(rows.map((row) => [row.storage_key, row]));
  for (const path of new Set(paths)) {
    const row = byPath.get(path);
    if (!row || row.status === 'pending') throw new FileSecurityError('file_pending');
    if (row.status === 'infected') throw new FileSecurityError('file_infected');
    if (row.status !== 'clean' || !row.sha256 || !row.scanned_at)
      throw new FileSecurityError('file_scan_error');
    if (storage) {
      let valid = false;
      try {
        const stat = await storage.inspect(path);
        if (stat && stat.size.toString() === String(row.size_bytes)) {
          const hash = createHash('sha256');
          for await (const chunk of await storage.openReadStream(path)) hash.update(chunk);
          valid = hash.digest('hex') === row.sha256;
        }
      } catch {
        /* A missing or changed file is never released using old evidence. */
      }
      if (!valid) {
        await db
          .updateTable('file_security')
          .set({
            status: 'pending',
            generation: sql`generation+1`,
            sha256: null,
            scanned_at: null,
            attempts: 0,
            error_code: 'content_changed',
            lease_token: null,
            lease_expires_at: null,
            next_attempt_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', row.id)
          .where('generation', '=', row.generation)
          .execute();
        throw new FileSecurityError('file_pending');
      }
    }
  }
}
/** Only used immediately after Storage.copyFile, which copies exactly the verified source bytes. */
export async function inheritFileSecurity(
  db: Kysely<DB>,
  sourceKey: string,
  destinationKey: string,
) {
  const source = await db
    .selectFrom('file_security')
    .selectAll()
    .where('storage_key', '=', sourceKey)
    .executeTakeFirst();
  if (!source || source.status !== 'clean' || !source.sha256 || !source.scanned_at)
    throw new FileSecurityError('file_pending');
  await db
    .updateTable('file_security')
    .set({
      status: 'clean',
      sha256: source.sha256,
      scanned_at: source.scanned_at,
      engine_version: source.engine_version,
      signature_version: source.signature_version,
      definitions_at: source.definitions_at,
      threat_name: null,
      error_code: null,
      updated_at: new Date(),
    })
    .where('storage_key', '=', destinationKey)
    .where('tenant_id', 'is not distinct from', source.tenant_id)
    .where('size_bytes', '=', source.size_bytes)
    .where('status', '=', 'pending')
    .executeTakeFirst();
}
