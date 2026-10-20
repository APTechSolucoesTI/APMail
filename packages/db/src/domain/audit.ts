import type { Kysely, Transaction } from 'kysely';
import type { DB, Json } from '../types.js';
import { htmlToText } from '../sanitize.js';
export function safeAuditMetadata(value: Json): Json {
  if (Array.isArray(value)) return value.map(safeAuditMetadata);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/password|token|secret|body|credential|authorization|cookie/i.test(key))
        .map(([key, item]) => [key, safeAuditMetadata(item ?? null)]),
    );
  return value;
}
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
    requestId?: string | null;
    eventKey?: string | null;
  },
) {
  const actor = value.actorId
    ? await db
        .selectFrom('users')
        .select(['full_name', 'email'])
        .where('id', '=', value.actorId)
        .executeTakeFirst()
    : null;
  let mailboxId: string | null = null,
    subject: string | null = null,
    content: string | null = null;
  let mail: Json = {};
  if (value.entityType === 'message' && value.entityId) {
    const m = await db
      .selectFrom('messages')
      .select([
        'mailbox_id',
        'subject',
        'body_text',
        'body_html',
        'from_address',
        'from_name',
        'to_addresses',
        'cc_addresses',
        'bcc_addresses',
        'message_id_header',
        'thread_id',
        'outbox_id',
      ])
      .where('tenant_id', '=', value.tenantId)
      .where('id', '=', value.entityId)
      .executeTakeFirst();
    if (m) {
      mailboxId = m.mailbox_id;
      subject = m.subject;
      const text = m.body_text || htmlToText(m.body_html ?? '');
      content = text.slice(0, 200000);
      const attachments = await db
        .selectFrom('attachments')
        .select(['filename', 'size_bytes', 'content_type'])
        .where('tenant_id', '=', value.tenantId)
        .where('message_id', '=', value.entityId)
        .execute();
      mail = {
        from_address: m.from_address,
        from_name: m.from_name,
        to: m.to_addresses,
        cc: m.cc_addresses,
        bcc: m.bcc_addresses,
        message_id: m.message_id_header,
        thread_id: m.thread_id,
        outbox_id: m.outbox_id,
        attachments,
        content_truncated: text.length > 200000,
      };
    }
  } else if (value.entityType === 'outbox' && value.entityId) {
    const o = await db
      .selectFrom('outbox')
      .select([
        'mailbox_id',
        'subject',
        'to_addresses',
        'cc_addresses',
        'bcc_addresses',
        'kind',
        'scheduled_at',
        'reply_to_message_id',
        'status',
      ])
      .where('tenant_id', '=', value.tenantId)
      .where('id', '=', value.entityId)
      .executeTakeFirst();
    if (o) {
      mailboxId = o.mailbox_id;
      subject = o.subject;
      mail = {
        to: o.to_addresses,
        cc: o.cc_addresses,
        bcc: o.bcc_addresses,
        kind: o.kind,
        scheduled_at: o.scheduled_at?.toISOString() ?? null,
        reply_to_message_id: o.reply_to_message_id,
        status: o.status,
      };
    }
  } else if (value.entityType === 'thread' && value.entityId) {
    const t = await db
      .selectFrom('threads')
      .select(['mailbox_id', 'subject'])
      .where('tenant_id', '=', value.tenantId)
      .where('id', '=', value.entityId)
      .executeTakeFirst();
    if (t) {
      mailboxId = t.mailbox_id;
      subject = t.subject;
    }
  } else if (value.entityType === 'mailbox') mailboxId = value.entityId ?? null;
  const box = mailboxId
    ? await db
        .selectFrom('mailboxes')
        .select(['name', 'email_address'])
        .where('id', '=', mailboxId)
        .where('tenant_id', '=', value.tenantId)
        .executeTakeFirst()
    : null;
  const metadata = safeAuditMetadata(value.metadata ?? {});
  const userRefs = new Set<string>(),
    folderRefs = new Set<string>();
  const scanReferences = (item: Json): void => {
    if (Array.isArray(item)) {
      item.forEach(scanReferences);
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, v] of Object.entries(item)) {
      if (typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)) {
        if (/^(?:from_user_id|to_user_id|assigned_user_id|assigned_to|user_id)$/.test(key))
          userRefs.add(v);
        if (/^(?:previous_folder_id|target_folder_id)$/.test(key)) folderRefs.add(v);
      } else if (v !== undefined) scanReferences(v);
    }
  };
  scanReferences(metadata);
  const references: Record<string, string> = {};
  if (userRefs.size) {
    const users = await db
      .selectFrom('users as u')
      .innerJoin('tenant_members as tm', 'tm.user_id', 'u.id')
      .select(['u.id', 'u.full_name'])
      .where('tm.tenant_id', '=', value.tenantId)
      .where('u.id', 'in', [...userRefs])
      .execute();
    for (const u of users) references[u.id] = u.full_name;
  }
  if (folderRefs.size) {
    const folders = await db
      .selectFrom('folders')
      .select(['id', 'name'])
      .where('tenant_id', '=', value.tenantId)
      .where('id', 'in', [...folderRefs])
      .execute();
    for (const f of folders) references[f.id] = f.name;
  }
  const affected =
    value.entityType === 'user' && value.entityId
      ? await db
          .selectFrom('users')
          .select(['full_name', 'email'])
          .where('id', '=', value.entityId)
          .executeTakeFirst()
      : null;
  await db
    .insertInto('audit_logs')
    .values({
      tenant_id: value.tenantId,
      actor_id: value.actorId,
      action: value.action,
      entity_type: value.entityType,
      entity_id: value.entityId ?? null,
      actor_name: actor?.full_name ?? null,
      actor_email: actor?.email ?? null,
      mailbox_id: mailboxId,
      message_subject: subject,
      message_content: content,
      request_id: value.requestId ?? null,
      event_key: value.eventKey ?? null,
      metadata: {
        ...(Object.keys(references).length ? { references } : {}),
        ...(affected ? { affected_user: { name: affected.full_name, email: affected.email } } : {}),
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? metadata
          : { details: metadata }),
        ...(mailboxId ? { mailbox: box ?? { id: mailboxId } } : {}),
        ...(mail && typeof mail === 'object' && Object.keys(mail).length ? { message: mail } : {}),
      },
      ip: value.ip ?? null,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'event_key']).doNothing())
    .execute();
}
