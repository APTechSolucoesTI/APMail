import type { Socket } from 'socket.io';
import { z } from 'zod';
import type { Resources } from '../modules/resources.js';
import type { RequestContext } from '../authz/context.js';
import { requireThread } from '../modules/mail.js';
type Ack = (response: { ok: true } | { error: string }) => void;
type Entry = { full_name: string; composing: boolean; expires_at: number; socket_id: string };
export function installThreadPresence(
  socket: Socket,
  r: Resources,
  fresh: () => Promise<RequestContext | null>,
  track: (task: Promise<void>) => void,
  ordered: (operation: () => Promise<void>) => void,
) {
  const watched = new Set<string>(),
    composing = new Set<string>();
  const idSchema = z.object({ thread_id: z.uuid() });
  const emit = async (threadId: string) => {
    const key = 'presence:thread:' + threadId,
      entries = await r.redis.hgetall(key),
      users = [];
    for (const [userId, json] of Object.entries(entries)) {
      let e: Entry;
      try {
        e = JSON.parse(json) as Entry;
      } catch {
        await r.redis.eval(
          "if redis.call('HGET',KEYS[1],ARGV[1])==ARGV[2] then return redis.call('HDEL',KEYS[1],ARGV[1]) end; return 0",
          1,
          key,
          userId,
          json,
        );
        continue;
      }
      if (e.expires_at <= Date.now()) {
        await r.redis.eval(
          "if redis.call('HGET',KEYS[1],ARGV[1])==ARGV[2] then return redis.call('HDEL',KEYS[1],ARGV[1]) end; return 0",
          1,
          key,
          userId,
          json,
        );
        continue;
      }
      if (e.composing) users.push({ user_id: userId, full_name: e.full_name, composing: true });
    }
    r.io.to('thread:' + threadId).emit('thread:presence', { thread_id: threadId, users });
  };
  const clear = async (threadId: string) => {
    const c = socket.data.ctx as RequestContext,
      key = 'presence:thread:' + threadId;
    // Uma aba não apaga o heartbeat mais recente de outra aba do mesmo usuário.
    await r.redis.eval(
      "local v=redis.call('HGET',KEYS[1],ARGV[1]); if v and cjson.decode(v).socket_id==ARGV[2] then return redis.call('HDEL',KEYS[1],ARGV[1]) end; return 0",
      1,
      key,
      c.userId,
      socket.id,
    );
    composing.delete(threadId);
    await emit(threadId);
  };
  socket.on('thread:join', (payload: unknown, ack?: Ack) =>
    ordered(async () => {
      try {
        const { thread_id } = idSchema.parse(payload);
        const c = await fresh();
        await requireThread(c, r, thread_id);
        if (watched.size >= 100 && !watched.has(thread_id)) throw Error();
        await socket.join('thread:' + thread_id);
        watched.add(thread_id);
        await emit(thread_id);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: 'forbidden' });
      }
    }),
  );
  socket.on('thread:leave', (payload: unknown, ack?: Ack) =>
    ordered(async () => {
      try {
        const { thread_id } = idSchema.parse(payload);
        await requireThread(await fresh(), r, thread_id);
        if (composing.has(thread_id)) await clear(thread_id);
        watched.delete(thread_id);
        await socket.leave('thread:' + thread_id);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: 'forbidden' });
      }
    }),
  );
  socket.on('thread:composing', (payload: unknown, ack?: Ack) =>
    ordered(async () => {
      try {
        const b = idSchema.extend({ composing: z.boolean() }).parse(payload),
          c = await fresh();
        await requireThread(c, r, b.thread_id, 'send');
        if (!b.composing) {
          await clear(b.thread_id);
          ack?.({ ok: true });
          return;
        }
        const u = await r.db
          .selectFrom('users')
          .select('full_name')
          .where('id', '=', c!.userId)
          .executeTakeFirstOrThrow();
        await r.redis.hset(
          'presence:thread:' + b.thread_id,
          c!.userId,
          JSON.stringify({
            full_name: u.full_name,
            composing: true,
            expires_at: Date.now() + 60000,
            socket_id: socket.id,
          }),
        );
        await r.redis.expire('presence:thread:' + b.thread_id, 60);
        composing.add(b.thread_id);
        await emit(b.thread_id);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: 'forbidden' });
      }
    }),
  );
  const timer = setInterval(() => {
    for (const id of watched) track(emit(id));
  }, 10000);
  socket.on('disconnect', () => {
    clearInterval(timer);
    for (const id of composing) track(clear(id));
  });
}
