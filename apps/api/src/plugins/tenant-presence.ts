import type { Socket } from 'socket.io';
import type { RequestContext } from '../authz/context.js';
import type { Resources } from '../modules/resources.js';
export async function onlineUsers(r: Resources, tenantId: string) {
  const key = 'presence:tenant:' + tenantId;
  await r.redis.zremrangebyscore(key, 0, Date.now());
  const records = await r.redis.zrangebyscore(key, Date.now(), '+inf');
  const ids = [...new Set(records.map((record) => record.split('|')[0]!))];
  if (!ids.length) return [];
  return (
    await r.db
      .selectFrom('tenant_members')
      .select('user_id')
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .where('user_id', 'in', ids)
      .orderBy('user_id')
      .execute()
  ).map((person) => person.user_id);
}
export function installTenantPresence(
  socket: Socket,
  r: Resources,
  c: RequestContext,
  freshContext: () => Promise<RequestContext>,
  track: (task: Promise<void>) => void,
) {
  if (!c.tenantId) return;
  const tenantId = c.tenantId,
    key = 'presence:tenant:' + tenantId,
    member = c.userId + '|' + socket.id;
  let running = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    const task = running.then(operation);
    running = task.catch(() => undefined);
    track(task);
  };
  const presence = async (connected: boolean) => {
    if (connected) {
      await r.redis.zadd(key, Date.now() + 70000, member);
      await r.redis.expire(key, 90);
    } else await r.redis.zrem(key, member);
    r.io
      .to('tenant:' + tenantId)
      .emit('presence:changed', { online_user_ids: await onlineUsers(r, tenantId) });
  };
  enqueue(() => presence(socket.connected));
  const timer = setInterval(
    () =>
      enqueue(async () => {
        if (!socket.connected) return;
        try {
          await freshContext();
          await presence(true);
        } catch {
          socket.disconnect(true);
        }
      }),
    30000,
  );
  socket.on('disconnect', () => {
    clearInterval(timer);
    enqueue(() => presence(false));
  });
}
