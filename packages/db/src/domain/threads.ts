import { sql, type Kysely, type Transaction } from 'kysely';
import { externalParticipants, normalizeSubject, type Address } from '@apmail/shared';
import type { DB, Json, QueueStatus } from '../types.js';
export type Database = Kysely<DB> | Transaction<DB>;
export type ThreadMessage = {
  tenant_id: string;
  mailbox_id: string;
  subject: string;
  message_at: Date;
  in_reply_to: string | null;
  references_headers: string[];
  from_address: string;
  to_addresses: Address[];
  cc_addresses: Address[];
};
export async function resolveThread(
  db: Database,
  msg: ThreadMessage,
  ourAddresses: string[],
): Promise<string> {
  const candidates = [
    ...new Set([msg.in_reply_to, ...msg.references_headers].filter((s): s is string => !!s)),
  ].slice(-50);
  if (candidates.length) {
    const parent = await db
      .selectFrom('messages')
      .select('thread_id')
      .where('tenant_id', '=', msg.tenant_id)
      .where('mailbox_id', '=', msg.mailbox_id)
      .where('message_id_header', 'in', candidates)
      .where('deleted_at', 'is', null)
      .orderBy('message_at', 'desc')
      .executeTakeFirst();
    if (parent) return parent.thread_id;
  }
  const subject = normalizeSubject(msg.subject),
    participants = externalParticipants(msg, ourAddresses);
  if (subject.length >= 4 && participants.length) {
    const found = await db
      .selectFrom('threads')
      .select('id')
      .where('tenant_id', '=', msg.tenant_id)
      .where('mailbox_id', '=', msg.mailbox_id)
      .where('subject_normalized', '=', subject)
      .where('deleted_at', 'is', null)
      .where('last_message_at', '>=', new Date(msg.message_at.getTime() - 14 * 86400000))
      .where(sql<boolean>`participants && ${participants}::text[]`)
      .orderBy('last_message_at', 'desc')
      .executeTakeFirst();
    if (found) return found.id;
  }
  return (
    await db
      .insertInto('threads')
      .values({
        tenant_id: msg.tenant_id,
        mailbox_id: msg.mailbox_id,
        subject: msg.subject,
        subject_normalized: subject,
        participants,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}
export async function refreshThreadAggregates(db: Database, threadId: string): Promise<void> {
  const thread = await db
    .selectFrom('threads')
    .innerJoin('mailboxes as b', 'b.id', 'threads.mailbox_id')
    .select([
      'threads.id',
      'threads.tenant_id',
      'threads.mailbox_id',
      'threads.manual_done_at',
      'b.email_address',
      'b.aliases',
    ])
    .where('threads.id', '=', threadId)
    .forUpdate('threads')
    .executeTakeFirstOrThrow();
  const all = await db
    .selectFrom('messages as m')
    .leftJoin('folders as f', 'f.id', 'm.folder_id')
    .selectAll('m')
    .select('f.special_use')
    .where('m.tenant_id', '=', thread.tenant_id)
    .where('m.thread_id', '=', threadId)
    .where('m.deleted_at', 'is', null)
    .orderBy('m.message_at', 'asc')
    .execute();
  const messages = all.filter((m) => m.special_use !== 'trash' && m.special_use !== 'junk');
  const inbound = messages.filter((m) => m.direction === 'inbound' && !m.is_automated);
  const outbound = messages.filter((m) => m.direction === 'outbound');
  const firstInbound = inbound[0]?.message_at ?? null,
    lastInbound = inbound.at(-1)?.message_at ?? null;
  const last = messages.at(-1);
  const participants = [
    ...new Set(
      messages.flatMap((m) =>
        externalParticipants(
          {
            from_address: m.from_address,
            to_addresses: m.to_addresses as Address[],
            cc_addresses: m.cc_addresses as Address[],
          },
          [thread.email_address, ...thread.aliases],
        ),
      ),
    ),
  ];
  await db
    .updateTable('threads')
    .set({
      subject: messages[0]?.subject ?? '',
      snippet: last?.snippet ?? '',
      message_count: messages.length,
      has_attachments: messages.some((m) => m.has_attachments),
      first_message_at: messages[0]?.message_at ?? null,
      last_message_at: last?.message_at ?? null,
      first_inbound_at: firstInbound,
      last_inbound_at: lastInbound,
      last_outbound_at: outbound.at(-1)?.message_at ?? null,
      first_response_at: firstInbound
        ? (outbound.find((m) => m.message_at > firstInbound)?.message_at ?? null)
        : null,
      participants,
      manual_done_at:
        thread.manual_done_at && lastInbound && lastInbound > thread.manual_done_at
          ? null
          : thread.manual_done_at,
      // Conversas na lixeira continuam disponíveis pela pasta, mas não entram nas filas.
      deleted_at: all.length ? null : new Date(),
    })
    .where('id', '=', threadId)
    .where('tenant_id', '=', thread.tenant_id)
    .execute();
}
export async function recomputeThreadStatus(
  db: Database,
  threadId: string,
  _reason: string,
  _actorId: string | null,
) {
  void _reason;
  void _actorId;
  const thread = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', threadId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  let to: QueueStatus = 'none';
  const scheduled = await db.selectFrom('outbox').select('id').where('thread_id','=',threadId).where('status','in',['queued','scheduled','sending']).executeTakeFirst();
  if (scheduled && !thread.queue_excluded) to = 'scheduled';
  else if (
    !thread.queue_excluded &&
    thread.last_inbound_at &&
    (!thread.last_outbound_at || thread.last_inbound_at > thread.last_outbound_at)
  )
    to = 'to_reply';
  else if (!thread.queue_excluded && thread.last_outbound_at) to = 'awaiting_reply';
  const changed = to !== thread.queue_status;
  if (changed)
    await db
      .updateTable('threads')
      .set({ queue_status: to, queue_status_changed_at: new Date() })
      .where('id', '=', threadId)
      .execute();
  return { changed, from: thread.queue_status, to };
}
export async function touchThreads(
  db: Database,
  threadIds: string[],
  reason: string,
  actorId: string | null,
): Promise<void> {
  for (const id of [...new Set(threadIds)].sort()) {
    await refreshThreadAggregates(db, id);
    await recomputeThreadStatus(db, id, reason, actorId);
  }
}
// pg interpreta arrays JS como arrays PostgreSQL; JSONB precisa de serialização explícita.
export const asJson = (value: unknown) => sql<Json>`${JSON.stringify(value)}::jsonb`;
