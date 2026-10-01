import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contextForToken } from './auth.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from '../modules/resources.js';
import { installThreadPresence } from './thread-presence.js';
import { installChatSocket } from './chat-socket.js';
import { installTenantPresence } from './tenant-presence.js';
import { requireThread } from '../modules/mail.js';
export function installSocket(app: FastifyInstance, r: Resources) {
  const pending = new Set<Promise<void>>();
  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.catch(() => undefined).finally(() => pending.delete(task));
  };
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
    const freshContext = async () => {
      const fresh = await contextForToken(
        r.db,
        r.redis,
        socket.data.token as string,
        socket.handshake.address,
        socket.id,
      );
      if (!fresh || fresh.tenantId !== c.tenantId) throw new Error('unauthenticated');
      socket.data.ctx = fresh;
      return fresh;
    };
    let events = Promise.resolve();
    const ordered = (operation: () => Promise<void>) => {
      const task = events.then(async () => {
        if (socket.connected) await operation();
      });
      events = task.catch(() => undefined);
      track(task);
    };
    installThreadPresence(socket, r, freshContext, track, ordered);
    installChatSocket(socket, r, freshContext, ordered);
    void socket.join([
      'user:' + c.userId,
      'session:' + c.sessionHash,
      ...(c.tenantId ? ['tenant:' + c.tenantId] : []),
    ]);
    installTenantPresence(socket, r, c, freshContext, track);
    for (const event of ['mailbox:subscribe', 'mailbox:join'])
      socket.on(
        event,
        (payload: unknown, ack?: (response: { ok: boolean } | { error: string }) => void) =>
          ordered(async () => {
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
              ack?.(event === 'mailbox:join' ? { error: 'forbidden' } : { ok: false });
            }
          }),
      );
    socket.on('thread:subscribe', (payload: unknown, ack?: (response: { ok: boolean }) => void) =>
      ordered(async () => {
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
          await requireThread(fresh, r, thread_id);
          await socket.join('thread:' + thread_id);
          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false });
        }
      }),
    );
    socket.on('room:unsubscribe', (payload: unknown) => {
      const result = z
        .object({ type: z.enum(['mailbox', 'thread']), id: z.uuid() })
        .safeParse(payload);
      if (result.success)
        ordered(async () => {
          await socket.leave(result.data.type + ':' + result.data.id);
        });
    });
    socket.on(
      'mailbox:leave',
      (payload: unknown, ack?: (response: { ok: true } | { error: string }) => void) =>
        ordered(async () => {
          try {
            const { mailbox_id } = z.object({ mailbox_id: z.uuid() }).parse(payload);
            await requireMailboxPerm((await freshContext())!, r.db, mailbox_id, 'read');
            await socket.leave('mailbox:' + mailbox_id);
            ack?.({ ok: true });
          } catch {
            ack?.({ error: 'forbidden' });
          }
        }),
    );
  });
  return {
    drain: async () => {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
