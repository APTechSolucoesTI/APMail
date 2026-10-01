import { expect, it } from 'vitest';
import {
  chatMessageSchema,
  chatMessagesQuerySchema,
  shareThreadSchema,
  groupConversationSchema,
} from '../src/index.js';
const id = '00000000-0000-4000-8000-000000000001';
it('mensagens exigem conteúdo limitado e identidade estável', () => {
  expect(chatMessageSchema.parse({ body: '  Olá  ', client_id: 'retry-1' })).toEqual({
    body: 'Olá',
    client_id: 'retry-1',
  });
  for (const body of ['', ' ', 'x'.repeat(4001)])
    expect(chatMessageSchema.safeParse({ body, client_id: 'retry-1' }).success).toBe(false);
  expect(chatMessageSchema.safeParse({ body: 'Olá', client_id: '' }).success).toBe(false);
  expect(chatMessagesQuerySchema.safeParse({ before_id: id }).success).toBe(false);
  expect(chatMessagesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
});
it('participantes são deduplicados e compartilhamento exige destino', () => {
  expect(groupConversationSchema.parse({ name: ' Equipe ', user_ids: [id, id] })).toEqual({
    name: 'Equipe',
    user_ids: [id],
  });
  expect(shareThreadSchema.safeParse({ thread_id: id }).success).toBe(false);
  expect(shareThreadSchema.parse({ thread_id: id, user_ids: [id] })).toMatchObject({
    comment: '',
    conversation_ids: [],
    user_ids: [id],
  });
});
