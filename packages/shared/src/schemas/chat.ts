import { z } from 'zod';
const users = z
  .array(z.uuid())
  .max(100)
  .transform((ids) => [...new Set(ids)]);
export const directConversationSchema = z.object({ user_id: z.uuid() });
export const groupConversationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  user_ids: users,
});
export const chatParticipantsSchema = z.object({ user_ids: users.pipe(z.array(z.uuid()).min(1)) });
export const chatNameSchema = groupConversationSchema.pick({ name: true });
export const chatMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  client_id: z.string().trim().min(1).max(100),
});
export const chatEditSchema = chatMessageSchema.pick({ body: true });
export const chatMessagesQuerySchema = z
  .object({
    before: z.iso.datetime({ offset: true }).optional(),
    before_id: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => !q.before_id || q.before, {
    path: ['before'],
    message: 'Informe a data do cursor.',
  });
export const shareThreadSchema = z
  .object({
    thread_id: z.uuid(),
    conversation_ids: users.default([]),
    user_ids: users.default([]),
    comment: z.string().trim().max(4000).default(''),
    client_id: z.uuid().optional(),
  })
  .refine((x) => x.conversation_ids.length + x.user_ids.length > 0, {
    message: 'Escolha ao menos um destinatário.',
    path: ['user_ids'],
  });
export type ChatPerson = { id: string; full_name: string; avatar_url: string | null };
export type SharedThreadSnapshot = {
  subject: string;
  from_name: string;
  from_address: string;
  message_at: string;
  snippet: string;
  mailbox_id: string;
  mailbox_name: string;
};
export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender: ChatPerson;
  client_id: string | null;
  body: string;
  shared_thread_id: string | null;
  shared_snapshot: SharedThreadSnapshot | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};
export type ChatConversation = {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  participants: ChatPerson[];
  last_message: {
    body: string;
    sender_name: string;
    sender_id: string;
    created_at: string;
    is_shared: boolean;
    deleted: boolean;
  } | null;
  unread_count: number;
};
