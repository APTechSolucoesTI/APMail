import { sql } from 'kysely';
import { normalizeSubject, externalParticipants } from '@apmail/shared';
import type { Database, ThreadMessage } from './threads.js';

async function identity(db: Database, msg: ThreadMessage, header: string) {
  const mapped = await sql<{
    thread_id: string;
  }>`select i.thread_id from thread_message_identities i join threads t on t.id=i.thread_id where i.tenant_id=${msg.tenant_id}::uuid and i.mailbox_id=${msg.mailbox_id}::uuid and i.message_id_header=${header} and t.deleted_at is null`.execute(
    db,
  );
  if (mapped.rows[0]) return mapped.rows[0].thread_id;
  return (
    await db
      .selectFrom('messages')
      .select('thread_id')
      .where('tenant_id', '=', msg.tenant_id)
      .where('mailbox_id', '=', msg.mailbox_id)
      .where('message_id_header', '=', header)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .executeTakeFirst()
  )?.thread_id;
}
async function reserve(
  db: Database,
  msg: ThreadMessage,
  header: string,
  thread: string,
  observed: boolean,
) {
  await sql`insert into thread_message_identities(tenant_id,mailbox_id,message_id_header,thread_id,observed) values(${msg.tenant_id}::uuid,${msg.mailbox_id}::uuid,${header},${thread}::uuid,${observed}) on conflict(tenant_id,mailbox_id,message_id_header) do update set observed=thread_message_identities.observed or excluded.observed where thread_message_identities.thread_id=excluded.thread_id`.execute(
    db,
  );
}
export async function createIndependentThread(
  db: Database,
  msg: ThreadMessage,
  ours: string[] = [],
): Promise<string> {
  const existing = msg.message_id_header
    ? await identity(db, msg, msg.message_id_header)
    : undefined;
  if (existing) return existing;
  const thread = (
    await db
      .insertInto('threads')
      .values({
        tenant_id: msg.tenant_id,
        mailbox_id: msg.mailbox_id,
        subject: msg.subject,
        subject_normalized: normalizeSubject(msg.subject),
        participants: externalParticipants(msg, ours),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  if (msg.message_id_header) await reserve(db, msg, msg.message_id_header, thread, true);
  return thread;
}
export async function resolveIncomingThread(
  db: Database,
  msg: ThreadMessage,
  ours: string[],
): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${msg.tenant_id + ':' + msg.mailbox_id},0))`.execute(
    db,
  );
  const own = msg.message_id_header ? await identity(db, msg, msg.message_id_header) : undefined;
  if (own) {
    await reserve(db, msg, msg.message_id_header, own, true);
    return own;
  }
  const refs = [
    ...new Set(
      [msg.in_reply_to, ...[...msg.references_headers].reverse()].filter(
        (v): v is string => !!v && v.length <= 998 && !/[\r\n]/.test(v),
      ),
    ),
  ].slice(0, 50);
  let parent: string | undefined;
  for (const ref of refs) {
    parent = await identity(db, msg, ref);
    if (parent) break;
  }
  const thread = parent ?? (await createIndependentThread(db, msg, ours));
  if (msg.message_id_header) await reserve(db, msg, msg.message_id_header, thread, true);
  for (const ref of refs)
    if (!(await identity(db, msg, ref))) await reserve(db, msg, ref, thread, false);
  return thread;
}
