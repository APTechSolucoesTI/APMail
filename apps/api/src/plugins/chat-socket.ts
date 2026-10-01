import type { Socket } from 'socket.io';
import { z } from 'zod';
import type { SocketAck } from '@apmail/shared';
import type { Resources } from '../modules/resources.js';
import type { RequestContext } from '../authz/context.js';
import { requireChat } from '../modules/chat/service.js';
export function installChatSocket(
  socket: Socket,
  r: Resources,
  freshContext: () => Promise<RequestContext>,
  ordered: (task: () => Promise<void>) => void,
) {
  const payloadSchema = z.object({ conversation_id: z.uuid() });
  for (const event of ['chat:join', 'chat:leave', 'chat:typing'] as const)
    socket.on(event, (input: unknown, ack?: (value: SocketAck) => void) =>
      ordered(async () => {
        try {
          const { conversation_id } = payloadSchema.parse(input),
            { c } = await requireChat(r.db, await freshContext(), conversation_id);
          if (event === 'chat:join') await socket.join('chat:' + conversation_id);
          else if (event === 'chat:leave') await socket.leave('chat:' + conversation_id);
          else if (
            await r.redis.set('chat:typing:' + conversation_id + ':' + c.userId, '1', 'EX', 3, 'NX')
          ) {
            const user = await r.db
              .selectFrom('users')
              .select('full_name')
              .where('id', '=', c.userId)
              .executeTakeFirstOrThrow();
            socket.to('chat:' + conversation_id).emit('chat:typing', {
              conversation_id,
              user_id: c.userId,
              full_name: user.full_name,
            });
          }
          ack?.({ ok: true });
        } catch {
          ack?.({ error: 'forbidden' });
        }
      }),
    );
}
