import type { InfiniteData } from '@tanstack/react-query';
import type { ChatConversation, ChatMessage } from '@apmail/shared';
export type ChatLocalMessage = ChatMessage & { delivery?: 'sending' | 'failed' };
export type ChatCursor = { before: string; before_id: string } | undefined;
export type ChatPages = InfiniteData<ChatLocalMessage[], ChatCursor>;
export const chatName = (conversation: ChatConversation, userId: string) =>
  conversation.type === 'group'
    ? (conversation.name ?? 'Grupo')
    : (conversation.participants.find((p) => p.id !== userId)?.full_name ?? 'Conversa direta');
const timestamp = (value: string) =>
  value.replace(/\.(\d+)Z$/, (_, fraction: string) => '.' + fraction.padEnd(6, '0') + 'Z');
export function mergeChatPage(
  server: ChatMessage[],
  current: ChatPages | undefined,
): ChatLocalMessage[] {
  const pending = (current?.pages.flat() ?? []).filter(
    (message) =>
      message.delivery &&
      !server.some(
        (row) =>
          row.id === message.id ||
          (row.client_id === message.client_id && row.sender_id === message.sender_id),
      ),
  );
  return [...pending, ...server].sort(
    (a, b) =>
      timestamp(b.created_at).localeCompare(timestamp(a.created_at)) || b.id.localeCompare(a.id),
  );
}
export function upsertChatMessage(
  data: ChatPages | undefined,
  message: ChatLocalMessage,
): ChatPages | undefined {
  if (!data) return data;
  const matches = (row: ChatLocalMessage) =>
    row.id === message.id ||
    (!!message.client_id &&
      row.client_id === message.client_id &&
      row.sender_id === message.sender_id);
  const exists = data.pages.some((page) => page.some(matches));
  return {
    ...data,
    pages: data.pages.map((page, index) => {
      const rows = exists
        ? page.map((row) => (matches(row) ? message : row))
        : index === 0
          ? [message, ...page]
          : page;
      return [...rows].sort(
        (a, b) =>
          timestamp(b.created_at).localeCompare(timestamp(a.created_at)) ||
          b.id.localeCompare(a.id),
      );
    }),
  };
}
export function chatPreview(conversation: ChatConversation, userId: string) {
  const last = conversation.last_message;
  if (!last) return 'Inicie a conversa';
  if (last.deleted) return 'Mensagem apagada';
  return (
    (last.sender_id === userId ? 'Você: ' : '') +
    (last.is_shared ? 'E-mail compartilhado' : last.body)
  );
}
