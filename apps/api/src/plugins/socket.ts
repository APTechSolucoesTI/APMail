import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contextForToken } from './auth.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from '../modules/resources.js';
export function installSocket(app: FastifyInstance, r: Resources) {
  const origin = new URL(r.env.APP_URL).origin;
  r.io.use(async (socket, next) => {
    try {
      const headerOrigin =
        socket.handshake.headers.origin ??
        (socket.handshake.headers.referer
          ? new URL(socket.handshake.headers.referer).origin
          : null);
      if (headerOrigin !== origin) throw new Error('forbidden');
      const cookie = app.parseCookie(socket.handshake.headers.cookie ?? '').apmail_session;
      const unsigned = cookie ? app.unsignCookie(cookie) : null;
      if (!unsigned?.valid || !unsigned.value) throw new Error('unauthenticated');
      const ctx = await contextForToken(
        r.db,
        r.redis,
        unsigned.value,
        socket.handshake.address,
        socket.id,
      );
      if (!ctx) throw new Error('unauthenticated');
      socket.data.ctx = ctx;
      socket.data.token = unsigned.value;
      next();
    } catch {
      next(new Error('unauthenticated'));
    }
  });
  r.io.on('connection', (socket) => {
    const c = socket.data.ctx as Awaited<ReturnType<typeof contextForToken>>;
    if (!c) return;
    void socket.join([
      'user:' + c.userId,
      'session:' + c.sessionHash,
      ...(c.tenantId ? ['tenant:' + c.tenantId] : []),
    ]);
    const presenceKey = c.tenantId ? `presence:${c.tenantId}:${c.userId}` : null;
    async function presence(connected: boolean) {
      if (!presenceKey) return;
      if (connected) {
        await r.redis.zadd(presenceKey, Date.now() + 70000, socket.id);
        await r.redis.expire(presenceKey, 90);
      } else await r.redis.zrem(presenceKey, socket.id);
      await r.redis.zremrangebyscore(presenceKey, 0, Date.now());
      r.io.to('tenant:' + c!.tenantId).emit('presence:changed', {
        user_id: c!.userId,
        online: (await r.redis.zcard(presenceKey)) > 0,
      });
    }
    void presence(true).catch(() => undefined);
    const timer = setInterval(
      () =>
        void (async () => {
          const fresh = await contextForToken(
            r.db,
            r.redis,
            socket.data.token as string,
            socket.handshake.address,
            socket.id,
          );
          if (!fresh || fresh.tenantId !== c.tenantId) {
            socket.disconnect(true);
            return;
          }
          socket.data.ctx = fresh;
          await presence(true);
        })().catch(() => socket.disconnect(true)),
      30000,
    );
    socket.on(
      'mailbox:subscribe',
      async (payload: unknown, ack?: (response: { ok: boolean }) => void) => {
        try {
          const { mailbox_id } = z.object({ mailbox_id: z.uuid() }).parse(payload);
          const fresh = await contextForToken(
            r.db,
            r.redis,
            socket.data.token as string,
            socket.handshake.address,
            socket.id,
          );
          if (!fresh) throw new Error();
          await requireMailboxPerm(fresh, r.db, mailbox_id, 'read');
          await socket.join('mailbox:' + mailbox_id);
          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false });
        }
      },
    );
    socket.on('disconnect', () => {
      clearInterval(timer);
      void presence(false).catch(() => undefined);
    });
    socket.on(
      'thread:subscribe',
      async (payload: unknown, ack?: (response: { ok: boolean }) => void) => {
        try {
          const { thread_id } = z.object({ thread_id: z.uuid() }).parse(payload);
          const fresh = await contextForToken(
            r.db,
            r.redis,
            socket.data.token as string,
            socket.handshake.address,
            socket.id,
          );
          if (!fresh?.tenantId) throw new Error();
          const thread = await r.db
            .selectFrom('threads')
            .select('mailbox_id')
            .where('id', '=', thread_id)
            .where('tenant_id', '=', fresh.tenantId)
            .where('deleted_at', 'is', null)
            .executeTakeFirst();
          if (!thread) throw new Error();
          await requireMailboxPerm(fresh, r.db, thread.mailbox_id, 'read');
          await socket.join('thread:' + thread_id);
          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false });
        }
      },
    );
    socket.on('room:unsubscribe', (payload: unknown) => {
      const result = z
        .object({ type: z.enum(['mailbox', 'thread']), id: z.uuid() })
        .safeParse(payload);
      if (result.success) void socket.leave(result.data.type + ':' + result.data.id);
    });
  });
}
