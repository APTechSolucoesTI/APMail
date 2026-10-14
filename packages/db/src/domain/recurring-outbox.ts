import type { Kysely } from 'kysely';
import type { DB } from '../types.js';
import { recurrenceSchema, nextRecurrence } from '@apmail/shared';
import { asJson } from './threads.js';
import { lockStorageTenant, assertStorageCapacity } from '../quotas.js';
import { outboxJobId } from './outbox.js';
/** One future occurrence, atomically claimed by the series lock and unique sequence. */
export async function advanceRecurringOutbox(db: Kysely<DB>, sentId: string, now = new Date()) {
  const source = await db
    .selectFrom('outbox')
    .selectAll()
    .where('id', '=', sentId)
    .where('status', '=', 'sent')
    .executeTakeFirst();
  if (!source?.recurrence_id || !source.sent_message_id || !source.recurrence_sequence) return null;
  return db.transaction().execute(async (tx) => {
    await lockStorageTenant(tx, source.tenant_id);
    const series = await tx
      .selectFrom('mail_schedule_series')
      .selectAll()
      .where('id', '=', source.recurrence_id!)
      .where('tenant_id', '=', source.tenant_id)
      .where('mailbox_id', '=', source.mailbox_id)
      .forUpdate()
      .executeTakeFirst();
    if (!series || series.state !== 'active') return null;
    const sequence = source.recurrence_sequence! + 1;
    const existing = await tx
      .selectFrom('outbox')
      .selectAll()
      .where('recurrence_id', '=', series.id)
      .where('recurrence_sequence', '=', sequence)
      .executeTakeFirst();
    if (existing) return existing;
    const recurrence = recurrenceSchema.parse({
      unit: series.unit,
      interval: series.interval,
      timezone: series.timezone,
      end_at: series.end_at?.toISOString(),
      max_occurrences: series.max_occurrences ?? undefined,
    });
    const after = new Date(
      Math.max(now.getTime(), source.scheduled_at?.getTime() ?? source.send_after?.getTime() ?? 0),
    );
    const next = nextRecurrence(series.starts_at, recurrence, after);
    if (!next || (series.max_occurrences !== null && sequence > series.max_occurrences)) {
      await tx
        .updateTable('mail_schedule_series')
        .set({ state: 'completed', updated_at: now })
        .where('id', '=', series.id)
        .execute();
      return null;
    }
    const files = await tx
      .selectFrom('attachments')
      .select(['id', 'is_inline'])
      .where('tenant_id', '=', source.tenant_id)
      .where('message_id', '=', source.sent_message_id!)
      .execute();
    const inserted = await tx
      .insertInto('outbox')
      .values({
        tenant_id: source.tenant_id,
        mailbox_id: source.mailbox_id,
        created_by: source.created_by,
        kind: source.kind,
        thread_id: source.kind === 'new' ? null : source.thread_id,
        reply_to_message_id: source.reply_to_message_id,
        subject: source.subject,
        body_html: source.body_html,
        signature_id: null,
        to_addresses: asJson(source.to_addresses),
        cc_addresses: asJson(source.cc_addresses),
        bcc_addresses: asJson(source.bcc_addresses),
        attachments: asJson(
          files.map((file) => ({
            source: 'message_attachment',
            attachment_id: file.id,
            inline: file.is_inline,
          })),
        ),
        recurrence_id: series.id,
        recurrence_sequence: sequence,
        status: 'scheduled',
        scheduled_at: next,
        send_after: next,
        submit_count: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const result = await tx
      .updateTable('outbox')
      .set({ job_id: outboxJobId(inserted.id, 1) })
      .where('id', '=', inserted.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('outbox')
      .set({ last_error: null })
      .where('id', '=', source.id)
      .where('status', '=', 'sent')
      .execute();
    await assertStorageCapacity(tx, source.tenant_id, source.mailbox_id);
    return result;
  });
}
