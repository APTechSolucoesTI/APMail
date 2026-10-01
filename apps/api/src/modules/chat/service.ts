import { sql, type Selectable } from 'kysely';
import { asJson, createNotification, type ChatMessages, type Database } from '@apmail/db';
import {
  chatMessagesQuerySchema,
  type ChatMessage,
  type ChatConversation,
  type SharedThreadSnapshot,
} from '@apmail/shared';
import {
  requireTenant,
  notFound,
  conflict,
  forbidden,
  type RequestContext,
} from '../../authz/context.js';
import { avatarUrl } from '../auth.js';
import { requireThread } from '../mail.js';
import type { Resources } from '../resources.js';
type TenantContext = ReturnType<typeof requireTenant>;
const preciseCreatedAt =
  sql<string>`to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
    'created_at_exact',
  );
type MessageRow = Selectable<ChatMessages> & { created_at_exact?: string };
export async function requireChat(
  db: Database,
  ctx: RequestContext | null,
  id: string,
  lock = false,
) {
  const c = requireTenant(ctx);
  let query = db
    .selectFrom('chat_conversations as cc')
    .innerJoin('chat_participants as cp', 'cp.conversation_id', 'cc.id')
    .innerJoin('tenant_members as tm', (j) =>
      j.onRef('tm.user_id', '=', 'cp.user_id').onRef('tm.tenant_id', '=', 'cc.tenant_id'),
    )
    .select(['cc.id', 'cc.type', 'cc.name', 'cc.tenant_id'])
    .where('cc.id', '=', id)
    .where('cc.tenant_id', '=', c.tenantId)
    .where('cp.tenant_id', '=', c.tenantId)
    .where('cp.user_id', '=', c.userId)
    .where('cp.left_at', 'is', null)
    .where('tm.status', '=', 'active');
  if (lock) query = query.forUpdate('cc');
  const conversation = await query.executeTakeFirst();
  if (!conversation) throw notFound();
  return { c, conversation };
}
async function requirePeople(db: Database, c: TenantContext, ids: string[]) {
  if (!ids.length || ids.length > 100) throw conflict('Escolha de 1 a 100 participantes.');
  const people = await db
    .selectFrom('tenant_members')
    .select('user_id')
    .where('tenant_id', '=', c.tenantId)
    .where('status', '=', 'active')
    .where('user_id', 'in', ids)
    .execute();
  if (people.length !== ids.length) throw conflict('Escolha pessoas ativas desta empresa.');
}
async function directInTx(db: Database, c: TenantContext, userId: string) {
  if (userId === c.userId) throw conflict('Escolha outra pessoa para iniciar a conversa.');
  await requirePeople(db, c, [c.userId, userId]);
  const key = [c.userId, userId].sort().join(':');
  const inserted = await db
    .insertInto('chat_conversations')
    .values({ tenant_id: c.tenantId, type: 'direct', direct_key: key, created_by: c.userId })
    .onConflict((oc) => oc.columns(['tenant_id', 'direct_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  const row =
    inserted ??
    (await db
      .selectFrom('chat_conversations')
      .select('id')
      .where('tenant_id', '=', c.tenantId)
      .where('direct_key', '=', key)
      .executeTakeFirstOrThrow());
  if (inserted)
    await db
      .insertInto('chat_participants')
      .values(
        [c.userId, userId].map((user_id) => ({
          tenant_id: c.tenantId,
          conversation_id: row.id,
          user_id,
        })),
      )
      .execute();
  return row.id;
}
export async function participants(db: Database, tenantId: string, id: string) {
  return db
    .selectFrom('chat_participants as cp')
    .innerJoin('tenant_members as tm', (j) =>
      j.onRef('tm.user_id', '=', 'cp.user_id').onRef('tm.tenant_id', '=', 'cp.tenant_id'),
    )
    .leftJoin('user_preferences as p', 'p.user_id', 'cp.user_id')
    .select(['cp.user_id', 'p.notify_chat'])
    .where('cp.tenant_id', '=', tenantId)
    .where('cp.conversation_id', '=', id)
    .where('cp.left_at', 'is', null)
    .where('tm.status', '=', 'active')
    .execute();
}
async function changed(r: Resources, tenantId: string, id: string, extra: string[] = []) {
  const ids = [
    ...new Set([...(await participants(r.db, tenantId, id)).map((p) => p.user_id), ...extra]),
  ];
  for (const uid of ids) r.io.to('user:' + uid).emit('chat:conversations-changed', {});
}
export async function createDirect(r: Resources, ctx: RequestContext | null, userId: string) {
  const c = requireTenant(ctx),
    id = await r.db.transaction().execute((tx) => directInTx(tx, c, userId));
  await changed(r, c.tenantId, id);
  return { id };
}
export async function createGroup(
  r: Resources,
  ctx: RequestContext | null,
  input: { name: string; user_ids: string[] },
) {
  const c = requireTenant(ctx),
    ids = [...new Set([c.userId, ...input.user_ids])];
  if (ids.length < 3)
    throw conflict('O grupo precisa de pelo menos três participantes, incluindo você.');
  const id = await r.db.transaction().execute(async (tx) => {
    await requirePeople(tx, c, ids);
    const row = await tx
      .insertInto('chat_conversations')
      .values({ tenant_id: c.tenantId, type: 'group', name: input.name, created_by: c.userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('chat_participants')
      .values(ids.map((user_id) => ({ tenant_id: c.tenantId, conversation_id: row.id, user_id })))
      .execute();
    return row.id;
  });
  await changed(r, c.tenantId, id);
  return { id };
}
export async function changeGroup(
  r: Resources,
  ctx: RequestContext | null,
  id: string,
  action: 'name' | 'add' | 'leave',
  value?: string | string[],
) {
  const c = requireTenant(ctx);
  await r.db.transaction().execute(async (tx) => {
    const { conversation } = await requireChat(tx, c, id, true);
    if (conversation.type !== 'group') throw forbidden();
    if (action === 'name')
      await tx
        .updateTable('chat_conversations')
        .set({ name: value as string })
        .where('id', '=', id)
        .execute();
    else if (action === 'leave')
      await tx
        .updateTable('chat_participants')
        .set({ left_at: sql`clock_timestamp()` })
        .where('conversation_id', '=', id)
        .where('user_id', '=', c.userId)
        .execute();
    else {
      const ids = value as string[];
      await requirePeople(tx, c, ids);
      const existing = await participants(tx, c.tenantId, id);
      if (new Set([...existing.map((p) => p.user_id), ...ids]).size > 100)
        throw conflict('O grupo aceita até 100 participantes.');
      for (const user_id of ids)
        await tx
          .insertInto('chat_participants')
          .values({
            tenant_id: c.tenantId,
            conversation_id: id,
            user_id,
            joined_at: sql`clock_timestamp()`,
          })
          .onConflict((oc) =>
            oc.columns(['conversation_id', 'user_id']).doUpdateSet({
              left_at: null,
              joined_at: sql`case when chat_participants.left_at is not null then clock_timestamp() else chat_participants.joined_at end`,
              last_read_at: sql`case when chat_participants.left_at is not null then null else chat_participants.last_read_at end`,
            }),
          )
          .execute();
    }
  });
  if (action === 'leave') r.io.in('user:' + c.userId).socketsLeave('chat:' + id);
  await changed(r, c.tenantId, id, [c.userId]);
  return { ok: true };
}
export async function conversations(r: Resources, ctx: RequestContext | null) {
  const c = requireTenant(ctx);
  return (
    await sql<ChatConversation>`select cc.id,cc.type,cc.name,
    coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'full_name',u.full_name,'avatar_url',case when u.avatar_path is not null then '/api/avatars/'||u.id||'?v='||extract(epoch from u.updated_at)::bigint else null end) order by u.full_name,u.id) from chat_participants cp join users u on u.id=cp.user_id join tenant_members tm on tm.tenant_id=cp.tenant_id and tm.user_id=cp.user_id and tm.status='active' where cp.conversation_id=cc.id and cp.tenant_id=${c.tenantId} and cp.left_at is null),'[]') participants,
    (select jsonb_build_object('body',case when m.deleted_at is not null then '' else m.body end,'sender_name',u.full_name,'sender_id',u.id,'created_at',m.created_at,'is_shared',m.shared_thread_id is not null,'deleted',m.deleted_at is not null) from chat_messages m join users u on u.id=m.sender_id where m.conversation_id=cc.id and m.tenant_id=${c.tenantId} order by m.created_at desc,m.id desc limit 1) last_message,
    (select count(*)::int from chat_messages m where m.conversation_id=cc.id and m.tenant_id=${c.tenantId} and m.sender_id!=${c.userId} and m.deleted_at is null and m.created_at>=mine.joined_at and (mine.last_read_at is null or m.created_at>mine.last_read_at)) unread_count
    from chat_conversations cc join chat_participants mine on mine.conversation_id=cc.id and mine.user_id=${c.userId} and mine.tenant_id=${c.tenantId} and mine.left_at is null where cc.tenant_id=${c.tenantId} order by cc.last_message_at desc nulls last,cc.id`.execute(
      r.db,
    )
  ).rows;
}
async function serialize(db: Database, row: MessageRow): Promise<ChatMessage> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'full_name', 'avatar_path', 'updated_at'])
    .where('id', '=', row.sender_id)
    .executeTakeFirstOrThrow();
  return messageWithUser(row, user);
}
function messageWithUser(
  row: MessageRow,
  user: { id: string; full_name: string; avatar_path: string | null; updated_at: Date },
): ChatMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sender: { id: user.id, full_name: user.full_name, avatar_url: avatarUrl(user) },
    client_id: row.client_id,
    body: row.deleted_at ? '' : row.body,
    shared_thread_id: row.deleted_at ? null : row.shared_thread_id,
    shared_snapshot: row.deleted_at ? null : (row.shared_snapshot as SharedThreadSnapshot | null),
    created_at: row.created_at_exact ?? row.created_at.toISOString(),
    edited_at: row.edited_at?.toISOString() ?? null,
    deleted_at: row.deleted_at?.toISOString() ?? null,
  };
}
export async function messages(
  r: Resources,
  ctx: RequestContext | null,
  id: string,
  input: unknown,
) {
  const { c } = await requireChat(r.db, ctx, id),
    q = chatMessagesQuerySchema.parse(input);
  let query = r.db
    .selectFrom('chat_messages')
    .selectAll()
    .select(preciseCreatedAt)
    .where('conversation_id', '=', id)
    .where('tenant_id', '=', c.tenantId);
  if (q.before)
    query = q.before_id
      ? query.where(sql<boolean>`(created_at,id)<(${q.before}::timestamptz,${q.before_id}::uuid)`)
      : query.where('created_at', '<', new Date(q.before));
  const rows = await query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(q.limit)
    .execute();
  if (!rows.length) return [];
  const people = await r.db
    .selectFrom('users')
    .select(['id', 'full_name', 'avatar_path', 'updated_at'])
    .where('id', 'in', [...new Set(rows.map((row) => row.sender_id))])
    .execute();
  const directory = new Map(people.map((person) => [person.id, person]));
  return rows.map((row) => messageWithUser(row, directory.get(row.sender_id)!));
}
async function insertMessage(
  db: Database,
  c: TenantContext,
  conversationId: string,
  input: {
    body: string;
    client_id: string;
    shared_thread_id?: string;
    shared_snapshot?: SharedThreadSnapshot;
  },
) {
  const row = await db
    .insertInto('chat_messages')
    .values({
      tenant_id: c.tenantId,
      conversation_id: conversationId,
      sender_id: c.userId,
      body: input.body,
      client_id: input.client_id,
      shared_thread_id: input.shared_thread_id ?? null,
      shared_snapshot: input.shared_snapshot ? asJson(input.shared_snapshot) : null,
      created_at: sql`clock_timestamp()`,
    })
    .onConflict((oc) => oc.columns(['sender_id', 'client_id']).doNothing())
    .returningAll()
    .returning(preciseCreatedAt)
    .executeTakeFirst();
  if (!row) {
    const existing = await db
      .selectFrom('chat_messages')
      .selectAll()
      .select(preciseCreatedAt)
      .where('sender_id', '=', c.userId)
      .where('client_id', '=', input.client_id)
      .executeTakeFirstOrThrow();
    if (
      existing.conversation_id !== conversationId ||
      existing.tenant_id !== c.tenantId ||
      existing.shared_thread_id !== (input.shared_thread_id ?? null)
    )
      throw conflict('Este identificador já foi usado em outra mensagem.');
    return { message: await serialize(db, existing), notifications: [], created: false };
  }
  const message = await serialize(db, row),
    notifications = [];
  for (const person of await participants(db, c.tenantId, conversationId))
    if (person.user_id !== c.userId && person.notify_chat !== false)
      notifications.push(
        await createNotification(db, {
          tenantId: c.tenantId,
          userId: person.user_id,
          type: 'chat_message',
          title: message.sender.full_name + ' enviou uma mensagem',
          body: message.body || 'E-mail compartilhado',
          link: '/chat/' + conversationId,
          payload: { conversation_id: conversationId, message_id: row.id },
        }),
      );
  return { message, notifications, created: true };
}
async function emitMessage(
  r: Resources,
  tenantId: string,
  result: Awaited<ReturnType<typeof insertMessage>>,
) {
  if (!result.created) return;
  for (const p of await participants(r.db, tenantId, result.message.conversation_id))
    r.io.to('user:' + p.user_id).emit('chat:message', {
      conversation_id: result.message.conversation_id,
      message: result.message,
    });
  for (const notification of result.notifications)
    r.io.to('user:' + notification.user_id).emit('notification:new', { notification });
}
export async function sendMessage(
  r: Resources,
  ctx: RequestContext | null,
  id: string,
  input: { body: string; client_id: string },
) {
  const c = requireTenant(ctx),
    result = await r.db.transaction().execute(async (tx) => {
      await requireChat(tx, c, id, true);
      return insertMessage(tx, c, id, input);
    });
  await emitMessage(r, c.tenantId, result);
  return result.message;
}
export async function changeMessage(
  r: Resources,
  ctx: RequestContext | null,
  id: string,
  body: string | null,
) {
  const c = requireTenant(ctx);
  const message = await r.db.transaction().execute(async (tx) => {
    const target = await tx
      .selectFrom('chat_messages')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .executeTakeFirst();
    if (!target) throw notFound();
    await requireChat(tx, c, target.conversation_id, true);
    const row = await tx
      .selectFrom('chat_messages')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.sender_id !== c.userId) throw forbidden();
    if (row.deleted_at || Date.now() - row.created_at.getTime() > 900000)
      throw conflict('A edição e exclusão estão disponíveis por 15 minutos.');
    const updated = await tx
      .updateTable('chat_messages')
      .set(
        body === null
          ? {
              body: '',
              shared_snapshot: null,
              shared_thread_id: null,
              deleted_at: sql`clock_timestamp()`,
            }
          : { body, edited_at: sql`clock_timestamp()` },
      )
      .where('id', '=', id)
      .returningAll()
      .returning(preciseCreatedAt)
      .executeTakeFirstOrThrow();
    return serialize(tx, updated);
  });
  r.io
    .to('chat:' + message.conversation_id)
    .emit('chat:message-updated', { conversation_id: message.conversation_id, message });
  await changed(r, c.tenantId, message.conversation_id);
  return message;
}
export async function readConversation(r: Resources, ctx: RequestContext | null, id: string) {
  const c = requireTenant(ctx);
  await r.db.transaction().execute(async (tx) => {
    await requireChat(tx, c, id, true);
    await tx
      .updateTable('chat_participants')
      .set({ last_read_at: sql`clock_timestamp()` })
      .where('conversation_id', '=', id)
      .where('user_id', '=', c.userId)
      .execute();
  });
  r.io.to('user:' + c.userId).emit('chat:conversations-changed', {});
  return { ok: true };
}
export async function shareThread(
  r: Resources,
  ctx: RequestContext | null,
  input: {
    thread_id: string;
    conversation_ids: string[];
    user_ids: string[];
    comment: string;
    client_id?: string;
  },
) {
  const { c, thread } = await requireThread(ctx, r, input.thread_id);
  const latest = await r.db
    .selectFrom('messages')
    .select(['subject', 'from_name', 'from_address', 'message_at', 'snippet'])
    .where('thread_id', '=', thread.id)
    .where('tenant_id', '=', c.tenantId)
    .where('deleted_at', 'is', null)
    .orderBy('message_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!latest) throw notFound();
  const box = await r.db
    .selectFrom('mailboxes')
    .select('name')
    .where('id', '=', thread.mailbox_id)
    .executeTakeFirstOrThrow();
  const snapshot: SharedThreadSnapshot = {
    ...latest,
    message_at: latest.message_at.toISOString(),
    mailbox_id: thread.mailbox_id,
    mailbox_name: box.name,
  };
  const results = await r.db.transaction().execute(async (tx) => {
    const ids = [...input.conversation_ids];
    for (const user of [...input.user_ids].sort()) ids.push(await directInTx(tx, c, user));
    const unique = [...new Set(ids)].sort(),
      out = [];
    for (const id of unique) {
      await requireChat(tx, c, id, true);
      out.push(
        await insertMessage(tx, c, id, {
          body: input.comment,
          client_id: (input.client_id ?? crypto.randomUUID()) + ':' + id,
          shared_thread_id: thread.id,
          shared_snapshot: snapshot,
        }),
      );
    }
    return out;
  });
  for (const result of results) {
    await changed(r, c.tenantId, result.message.conversation_id);
    await emitMessage(r, c.tenantId, result);
  }
  return {
    shared: results.length,
    conversation_ids: results.map((r) => r.message.conversation_id),
  };
}
