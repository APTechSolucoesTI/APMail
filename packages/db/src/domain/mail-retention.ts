import { sql, type Kysely } from 'kysely';
import type { DB } from '../types.js';
import { audit } from './audit.js';
import { asJson } from './threads.js';
import { lockStorageTenant } from '../quotas.js';

export const retentionExpiry = (deletedAt: Date, days: number) =>
  new Date(deletedAt.getTime() + days * 86_400_000);

/** Discard recoverable content atomically. Keep source identities and foreign keys as tombstones. */
export async function purgeRetainedMessage(
  db: Kysely<DB>,
  tenantId: string,
  messageId: string,
  now = new Date(),
) {
  return db.transaction().execute(async (tx) => {
    await lockStorageTenant(tx, tenantId);
    const message = await tx
      .selectFrom('messages')
      .select(['id', 'mailbox_id', 'raw_storage_path', 'retention_purge_requested_by'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', messageId)
      .where('retention_expires_at', 'is not', null)
      .where('pending_action', '=', false)
      .where((eb) =>
        eb.or([
          eb('retention_expires_at', '<=', now),
          eb('retention_purge_requested_at', 'is not', null),
        ]),
      )
      .forUpdate()
      .executeTakeFirst();
    if (!message) return 'skipped';
    const attachmentInUse = await sql<{ used: boolean }>`
      select exists(
        select 1 from outbox o
        where o.tenant_id=${tenantId}::uuid
          and o.status in ('draft','queued','scheduled','sending','failed')
          and exists(select 1 from attachments a
            where a.tenant_id=o.tenant_id and a.message_id=${messageId}::uuid
              and o.attachments @> jsonb_build_array(jsonb_build_object('attachment_id',a.id))
          )
      ) as used`.execute(tx);
    if (attachmentInUse.rows[0]?.used) {
      await tx
        .updateTable('messages')
        .set({
          retention_retry_at: new Date(now.getTime() + 15 * 60_000),
          retention_last_error: 'Há anexos em uso em rascunhos ou envios. A limpeza será retomada.',
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', messageId)
        .execute();
      return 'in_use';
    }
    const files = await tx
      .deleteFrom('attachments')
      .where('tenant_id', '=', tenantId)
      .where('message_id', '=', messageId)
      .returning('storage_path')
      .execute();
    const keys = [message.raw_storage_path, ...files.map((file) => file.storage_path)].filter(
      (key): key is string => key !== null,
    );
    await tx
      .updateTable('messages')
      .set({
        raw_storage_path: null,
        body_text: '',
        body_html: null,
        snippet: '',
        subject: '',
        from_address: '',
        from_name: '',
        to_addresses: asJson([]),
        cc_addresses: asJson([]),
        bcc_addresses: asJson([]),
        reply_to_addresses: asJson([]),
        references_headers: [],
        in_reply_to: null,
        size_bytes: 0,
        has_attachments: false,
        auto_reply_to: null,
        mdn_request: null,
        calendar_invite: null,
        retention_expires_at: null,
        retention_deleted_by: null,
        retention_purge_requested_at: null,
        retention_purge_requested_by: null,
        retention_retry_at: null,
        retention_last_error: null,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', messageId)
      .execute();
    // The audit trail keeps actor, time and operation, but does not retain the purged message body.
    await tx
      .updateTable('audit_logs')
      .set({
        message_content: null,
        message_subject: null,
        metadata: sql`metadata - 'message'`,
      })
      .where('tenant_id', '=', tenantId)
      .where('entity_type', '=', 'message')
      .where('entity_id', '=', messageId)
      .execute();
    if (keys.length)
      await tx
        .updateTable('storage_assets')
        .set({ category: 'retention_purge_pending' })
        .where('tenant_id', '=', tenantId)
        .where('storage_key', 'in', keys)
        .execute();
    await audit(tx, {
      tenantId,
      actorId: message.retention_purge_requested_by,
      action: 'retention.message_purged',
      entityType: 'retained_message',
      entityId: messageId,
      metadata: { mailbox_id: message.mailbox_id },
    });
    return 'purged';
  });
}
