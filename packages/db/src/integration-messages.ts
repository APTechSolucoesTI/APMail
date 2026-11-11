import { sql, type Kysely } from 'kysely';
import type { DB, Json } from './types.js';
import { securityForFiles } from './security/files.js';

function addresses(value: Json) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item && typeof item === 'object' && !Array.isArray(item) && typeof item.address === 'string'
      ? [{ name: typeof item.name === 'string' ? item.name : '', email: item.address }]
      : [],
  );
}

/** Shared GET/webhook contract. No storage keys, credentials or private team notes leave the server. */
export async function serializeIntegrationMessages(
  db: Kysely<DB>,
  tenantId: string,
  ids: string[],
  options: { userId?: string; includeBody?: boolean } = {},
) {
  if (!ids.length) return [];
  const rows = await db
    .selectFrom('messages as m')
    .innerJoin('mailboxes as b', (j) =>
      j.onRef('b.id', '=', 'm.mailbox_id').onRef('b.tenant_id', '=', 'm.tenant_id'),
    )
    .innerJoin('threads as t', (j) =>
      j.onRef('t.id', '=', 'm.thread_id').onRef('t.tenant_id', '=', 'm.tenant_id'),
    )
    .select([
      'm.id',
      'm.tenant_id',
      'm.mailbox_id',
      'm.thread_id',
      'm.message_id_header',
      'm.direction',
      'm.subject',
      'm.from_address',
      'm.from_name',
      'm.to_addresses',
      'm.cc_addresses',
      'm.bcc_addresses',
      'm.reply_to_addresses',
      'm.in_reply_to',
      'm.references_headers',
      'm.message_at',
      'm.created_at',
      'm.is_historical',
      'm.is_automated',
      'm.is_mdn',
      'm.is_flagged',
      'm.source_kind',
      'm.size_bytes',
      'b.email_address as mailbox_email',
      'b.name as mailbox_name',
      't.queue_status',
      't.assigned_to',
      (options.includeBody !== false
        ? sql<string | null>`m.body_html_original`
        : sql<string | null>`null`
      ).as('original_html'),
      (options.includeBody !== false
        ? sql<string | null>`m.body_html`
        : sql<string | null>`null`
      ).as('html'),
      (options.includeBody !== false
        ? sql<string | null>`m.body_text`
        : sql<string | null>`null`
      ).as('text'),
      (options.userId
        ? sql<
            boolean | null
          >`m.direction<>'inbound' or exists(select 1 from thread_user_state us where us.thread_id=m.thread_id and us.tenant_id=m.tenant_id and us.user_id=${options.userId} and us.last_read_at>=m.message_at)`
        : sql<boolean | null>`null`
      ).as('is_read'),
    ])
    .where('m.tenant_id', '=', tenantId)
    .where('m.id', 'in', ids)
    .where('m.deleted_at', 'is', null)
    .where('t.deleted_at', 'is', null)
    .where('b.deleted_at', 'is', null)
    .execute();
  if (!rows.length) return [];
  const attachments = await db
    .selectFrom('attachments')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where(
      'message_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const security = await securityForFiles(
    db,
    attachments.map((attachment) => attachment.storage_path),
  );
  const byMessage = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    const list = byMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    byMessage.set(attachment.message_id, list);
  }
  const order = new Map(ids.map((id, index) => [id, index]));
  return rows
    .sort((left, right) => order.get(left.id)! - order.get(right.id)!)
    .map((m) => {
      const files = (byMessage.get(m.id) ?? []).map((a) => {
        const state = security.get(a.storage_path)!;
        return {
          id: a.id,
          filename: a.filename,
          contentType: a.content_type,
          size: a.size_bytes,
          inline: a.is_inline,
          contentId: a.content_id,
          downloadUrl: `/api/integrations/messages/${m.id}/attachments/${a.id}`,
          security: {
            status: state.status,
            accessAllowed: state.access_allowed,
            threatName: state.threat_name,
            scannedAt: state.scanned_at,
          },
        };
      });
      return {
        id: m.id,
        messageId: m.message_id_header,
        threadId: m.thread_id,
        tenantId: m.tenant_id,
        mailbox: { id: m.mailbox_id, email: m.mailbox_email, name: m.mailbox_name },
        direction: m.direction,
        subject: m.subject,
        from: { name: m.from_name, email: m.from_address },
        to: addresses(m.to_addresses),
        cc: addresses(m.cc_addresses),
        bcc: addresses(m.bcc_addresses),
        replyTo: addresses(m.reply_to_addresses),
        messageAt: m.message_at.toISOString(),
        receivedAt: m.created_at.toISOString(),
        isRead: m.is_read,
        body:
          options.includeBody === false
            ? null
            : {
                text: m.text,
                html: m.original_html ?? m.html,
                sanitizedHtml: m.html,
                hasHtml: !!(m.original_html ?? m.html),
                originalAvailable: m.original_html !== null,
              },
        bodyIncluded: options.includeBody !== false,
        inReplyTo: m.in_reply_to,
        references: m.references_headers,
        status: m.queue_status,
        assignedTo: m.assigned_to,
        isHistorical: m.is_historical,
        isAutomated: m.is_automated,
        isReadReceipt: m.is_mdn,
        isFlagged: m.is_flagged,
        source: m.source_kind,
        size: m.size_bytes,
        attachments: files,
        attachmentCount: files.length,
        hasAttachments: files.length > 0,
      };
    });
}
