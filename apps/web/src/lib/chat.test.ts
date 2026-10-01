import { expect, it } from 'vitest';
import { upsertChatMessage, mergeChatPage, type ChatPages, type ChatLocalMessage } from './chat';
const message: ChatLocalMessage = {
  id: 'local-one',
  conversation_id: 'conversation',
  sender_id: 'sender',
  sender: { id: 'sender', full_name: 'Pessoa', avatar_url: null },
  client_id: 'stable',
  body: 'Olá',
  shared_thread_id: null,
  shared_snapshot: null,
  created_at: '2026-10-01T10:00:00.123Z',
  edited_at: null,
  deleted_at: null,
  delivery: 'sending',
};
it('ack e evento substituem a mesma mensagem otimista sem duplicar', () => {
  const data: ChatPages = { pages: [[message]], pageParams: [undefined] },
    confirmed = {
      ...message,
      id: 'server-id',
      created_at: '2026-10-01T10:00:00.123456Z',
      delivery: undefined,
    };
  const once = upsertChatMessage(data, confirmed),
    twice = upsertChatMessage(once, confirmed);
  expect(twice?.pages.flat()).toEqual([confirmed]);
  expect(data.pages[0]?.[0]?.delivery).toBe('sending');
  const other = { ...confirmed, id: 'another-id', sender_id: 'other' };
  expect(upsertChatMessage(twice, other)?.pages.flat()).toHaveLength(2);
});
it('preserva páginas e a precisão do cursor ao receber mensagens fora de ordem', () => {
  const first = {
      ...message,
      id: 'first',
      client_id: 'first',
      created_at: '2026-10-01T10:00:00.123002Z',
    },
    second = {
      ...message,
      id: 'second',
      client_id: 'second',
      created_at: '2026-10-01T10:00:00.123001Z',
    };
  const data: ChatPages = {
    pages: [[first], [{ ...message, id: 'older', client_id: 'older' }]],
    pageParams: [undefined, { before: first.created_at, before_id: first.id }],
  };
  const result = upsertChatMessage(data, second);
  expect(result?.pages[0]?.map((m) => m.id)).toEqual(['first', 'second']);
  expect(result?.pages[1]).toEqual(data.pages[1]);
});
it('entrada na sala e refetch preservam falhas locais até confirmar o mesmo client_id', () => {
  const failed = { ...message, delivery: 'failed' as const },
    data: ChatPages = { pages: [[failed]], pageParams: [undefined] };
  expect(mergeChatPage([], data)).toEqual([failed]);
  const confirmed = { ...message, id: 'server', delivery: undefined };
  expect(mergeChatPage([confirmed], data)).toEqual([confirmed]);
});
