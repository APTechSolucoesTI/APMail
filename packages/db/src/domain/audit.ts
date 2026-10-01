import type { Kysely, Transaction } from 'kysely';
import type { DB, Json } from '../types.js';
export function auditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Json {
  const previous: Record<string, Json> = {},
    next: Record<string, Json> = {};
  for (const [key, value] of Object.entries(after)) {
    if (/password|token|secret|body/i.test(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
      previous[key] =
        before[key] === undefined ? null : (JSON.parse(JSON.stringify(before[key])) as Json);
      next[key] = value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);
    }
  }
  return { before: previous, after: next };
}
export async function audit(
  db: Kysely<DB> | Transaction<DB>,
  value: {
    tenantId: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Json;
    ip?: string | null;
  },
) {
  await db
    .insertInto('audit_logs')
    .values({
      tenant_id: value.tenantId,
      actor_id: value.actorId,
      action: value.action,
      entity_type: value.entityType,
      entity_id: value.entityId ?? null,
      metadata: value.metadata ?? {},
      ip: value.ip ?? null,
    })
    .execute();
}
