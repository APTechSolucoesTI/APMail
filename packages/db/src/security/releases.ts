import { createHash } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import { antivirusFindingKind } from '@apmail/shared';
import type { DB } from '../types.js';
import type { Storage } from '../storage.js';
import type { FileSecurityRow } from './files.js';
import { audit } from '../domain/audit.js';

export const clearedRelease = {
  released_at: null,
  released_by: null,
  release_reason: null,
  release_sha256: null,
  release_generation: null,
  release_rule_id: null,
  release_kind: null,
  false_positive: false,
};
export function ruleAllowsFile(
  rule: Pick<Selectable<DB['antivirus_sender_rules']>, 'enabled' | 'expires_at'>,
  file: FileSecurityRow,
) {
  if (
    !rule.enabled ||
    (rule.expires_at && +new Date(rule.expires_at) <= Date.now()) ||
    !file.sha256 ||
    !file.scanned_at ||
    file.kind !== 'attachment'
  )
    return false;
  return ['infected', 'error'].includes(file.status);
}
async function decision(
  db: Kysely<DB>,
  file: FileSecurityRow,
  action: 'release' | 'revoke',
  actor: string | null,
  reason: string,
  sha256: string,
  ruleId: string | null,
  falsePositive = false,
) {
  if (!file.tenant_id) throw Error('file_release_scope');
  await db
    .insertInto('file_security_decisions')
    .values({
      tenant_id: file.tenant_id,
      file_id: file.id,
      action,
      actor_id: actor,
      rule_id: ruleId,
      reason,
      sha256,
      generation: file.generation,
      scan_status: file.status,
      threat_name: file.threat_name,
      false_positive: falsePositive,
    })
    .execute();
  await audit(db, {
    tenantId: file.tenant_id,
    actorId: actor,
    action: 'security.file_' + (action === 'release' ? 'released' : 'release_revoked'),
    entityType: 'security',
    entityId: file.id,
    metadata: {
      filename: file.filename,
      scan_status: file.status,
      threat: file.threat_name,
      reason,
      rule_id: ruleId,
      false_positive: falsePositive,
    },
  });
}
export async function releaseFile(
  db: Kysely<DB>,
  storage: Storage,
  file: FileSecurityRow,
  actor: string | null,
  reason: string,
  falsePositive: boolean,
  acknowledgeMalware = false,
  ruleId: string | null = null,
) {
  if (
    !file.tenant_id ||
    !['attachment', 'upload'].includes(file.kind) ||
    !['infected', 'error'].includes(file.status)
  )
    throw Error('file_release_ineligible');
  if (file.lease_expires_at && +new Date(file.lease_expires_at) > Date.now())
    throw Error('file_scan_busy');
  if (antivirusFindingKind(file) === 'malware' && !acknowledgeMalware)
    throw Error('file_release_malware_ack');
  const stat = await storage.inspect(file.storage_key);
  if (!stat || String(stat.size) !== String(file.size_bytes)) throw Error('file_content_changed');
  const hash = createHash('sha256');
  for await (const chunk of await storage.openReadStream(file.storage_key)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  if (file.sha256 && file.sha256 !== sha256) throw Error('file_content_changed');
  const row = await db
    .updateTable('file_security')
    .set({
      released_at: new Date(),
      released_by: actor,
      release_reason: reason,
      release_sha256: sha256,
      release_generation: file.generation,
      release_kind: ruleId ? 'sender' : 'manual',
      release_rule_id: ruleId,
      false_positive: falsePositive,
      updated_at: new Date(),
    })
    .where('id', '=', file.id)
    .where('tenant_id', '=', file.tenant_id)
    .where('generation', '=', file.generation)
    .returningAll()
    .executeTakeFirstOrThrow();
  await decision(db, row, 'release', actor, reason, sha256, ruleId, falsePositive);
  return row;
}
export async function revokeFileRelease(
  db: Kysely<DB>,
  file: FileSecurityRow,
  actor: string | null,
  reason: string,
) {
  if (file.released_at && file.release_sha256)
    await decision(
      db,
      file,
      'revoke',
      actor,
      reason,
      file.release_sha256,
      file.release_rule_id,
      file.false_positive,
    );
  return db
    .updateTable('file_security')
    .set({ ...clearedRelease, updated_at: new Date() })
    .where('id', '=', file.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}
/** Access approval is independent of the raw ClamAV verdict. */
export async function applySenderTrust(db: Kysely<DB>, file: FileSecurityRow, storage?: Storage) {
  if (
    !file.tenant_id ||
    !file.message_id ||
    file.kind !== 'attachment' ||
    !['infected', 'error'].includes(file.status)
  )
    return file;
  const message = await db
    .selectFrom('messages')
    .select(['from_address', 'direction'])
    .where('id', '=', file.message_id)
    .where('tenant_id', '=', file.tenant_id)
    .where('mailbox_id', '=', file.mailbox_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!message || message.direction !== 'inbound') return file;
  const rules = await db
    .selectFrom('antivirus_sender_rules')
    .selectAll()
    .where('tenant_id', '=', file.tenant_id)
    .where('sender', '=', message.from_address.trim().toLowerCase())
    .where('enabled', '=', true)
    .where((eb) => eb.or([eb('mailbox_id', '=', file.mailbox_id), eb('mailbox_id', 'is', null)]))
    .orderBy('mailbox_id', 'asc')
    .execute();
  const rule = rules.find((rule) => ruleAllowsFile(rule, file));
  const activeRule =
    rule ??
    rules.find(
      (rule) => rule.enabled && (!rule.expires_at || +new Date(rule.expires_at) > Date.now()),
    );
  if (!activeRule || !file.scanned_at) return file;
  if (
    file.release_kind === 'manual' &&
    file.release_generation === file.generation &&
    file.release_sha256 &&
    (!file.sha256 || file.release_sha256 === file.sha256)
  )
    return file;
  if (!file.sha256) {
    if (!storage) return file;
    try {
      return await releaseFile(
        db,
        storage,
        file,
        activeRule.updated_by ?? activeRule.created_by,
        `Remetente confiável: ${activeRule.sender}.`,
        false,
        true,
        activeRule.id,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'file_content_changed' ||
          error.message === 'file_scan_busy' ||
          ('code' in error && ['ENOENT', 'EACCES'].includes(String(error.code))))
      )
        return file;
      throw error;
    }
  }
  if (
    file.release_rule_id === activeRule.id &&
    file.release_generation === file.generation &&
    file.release_sha256 === file.sha256
  )
    return file;
  const reason = `Remetente confiável: ${activeRule.sender}.`;
  const row = await db
    .updateTable('file_security')
    .set({
      released_at: new Date(),
      released_by: activeRule.updated_by ?? activeRule.created_by,
      release_reason: reason,
      release_sha256: file.sha256,
      release_generation: file.generation,
      release_rule_id: activeRule.id,
      release_kind: 'sender',
      false_positive: false,
      updated_at: new Date(),
    })
    .where('id', '=', file.id)
    .where('generation', '=', file.generation)
    .returningAll()
    .executeTakeFirstOrThrow();
  await decision(
    db,
    row,
    'release',
    activeRule.updated_by ?? activeRule.created_by,
    reason,
    file.sha256,
    activeRule.id,
  );
  return row;
}
