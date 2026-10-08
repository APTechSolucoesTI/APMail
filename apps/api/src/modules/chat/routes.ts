import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  directConversationSchema,
  groupConversationSchema,
  chatParticipantsSchema,
  chatNameSchema,
  chatMessageSchema,
  chatEditSchema,
  shareThreadSchema,
} from '@apmail/shared';
import type { Resources } from '../resources.js';
import { requireThread } from '../mail.js';
import { requireTenant } from '../../authz/context.js';
import { onlineUsers } from '../../plugins/tenant-presence.js';
import {
  conversations,
  conversationList,
  createDirect,
  createGroup,
  changeGroup,
  messages,
  sendMessage,
  changeMessage,
  readConversation,
  shareThread,
} from './service.js';
const idOf = (input: unknown) => z.object({ id: z.uuid() }).parse(input).id;
export function registerChat(app: FastifyInstance, r: Resources) {
  app.get('/api/chat/presence', async (req) => ({
    online_user_ids: await onlineUsers(r, requireTenant(req.ctx).tenantId),
  }));
  app.get('/api/chat/conversations/list', (req) => conversationList(r, req.ctx, req.query));
  app.get('/api/chat/conversations', (req) => conversations(r, req.ctx));
  app.post('/api/chat/conversations/direct', (req) =>
    createDirect(r, req.ctx, directConversationSchema.parse(req.body).user_id),
  );
  app.post('/api/chat/conversations/group', (req) =>
    createGroup(r, req.ctx, groupConversationSchema.parse(req.body)),
  );
  app.patch('/api/chat/conversations/:id', (req) =>
    changeGroup(r, req.ctx, idOf(req.params), 'name', chatNameSchema.parse(req.body).name),
  );
  app.post('/api/chat/conversations/:id/participants', (req) =>
    changeGroup(
      r,
      req.ctx,
      idOf(req.params),
      'add',
      chatParticipantsSchema.parse(req.body).user_ids,
    ),
  );
  app.delete('/api/chat/conversations/:id/participants/me', (req) =>
    changeGroup(r, req.ctx, idOf(req.params), 'leave'),
  );
  app.get('/api/chat/conversations/:id/messages', (req) =>
    messages(r, req.ctx, idOf(req.params), req.query),
  );
  app.post('/api/chat/conversations/:id/messages', (req) =>
    sendMessage(r, req.ctx, idOf(req.params), chatMessageSchema.parse(req.body)),
  );
  app.patch('/api/chat/messages/:id', (req) =>
    changeMessage(r, req.ctx, idOf(req.params), chatEditSchema.parse(req.body).body),
  );
  app.delete('/api/chat/messages/:id', (req) => changeMessage(r, req.ctx, idOf(req.params), null));
  app.post('/api/chat/conversations/:id/read', (req) =>
    readConversation(r, req.ctx, idOf(req.params)),
  );
  app.post('/api/chat/share-thread', (req) =>
    shareThread(r, req.ctx, shareThreadSchema.parse(req.body)),
  );
  app.get('/api/chat/shared-threads/:id/access', async (req) => {
    await requireThread(req.ctx, r, idOf(req.params));
    return { allowed: true };
  });
}
