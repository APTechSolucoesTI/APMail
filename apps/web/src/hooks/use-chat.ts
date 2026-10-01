import { useContext, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import type { ChatConversation, ChatMessage, ServerEvents } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import {
  upsertChatMessage,
  mergeChatPage,
  type ChatPages,
  type ChatCursor,
  type ChatLocalMessage,
} from '@/lib/chat';
import { SocketContext } from './use-socket-room';
export function useChatConversations() {
  const me = useQuery(meQuery),
    tenant = useTenantId();
  return useQuery({
    queryKey: ['chat-conversations', tenant, me.data?.user.id],
    queryFn: ({ signal }) => api<ChatConversation[]>('/chat/conversations', { signal }),
    enabled: !!tenant && !!me.data,
    refetchInterval: 60000,
  });
}
export function useChatMessages(id: string) {
  const me = useQuery(meQuery),
    tenant = useTenantId(),
    client = useQueryClient(),
    key = ['chat-messages', tenant, id, me.data?.user.id];
  return useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as ChatCursor,
    queryFn: async ({ pageParam, signal }): Promise<ChatLocalMessage[]> => {
      const server = await api<ChatMessage[]>(
        '/chat/conversations/' +
          id +
          '/messages?' +
          new URLSearchParams({ limit: '50', ...pageParam }),
        { signal },
      );
      return pageParam ? server : mergeChatPage(server, client.getQueryData<ChatPages>(key));
    },
    getNextPageParam: (page) => {
      const persisted = page.filter((message) => !message.delivery);
      return persisted.length >= 50
        ? { before: persisted.at(-1)!.created_at, before_id: persisted.at(-1)!.id }
        : undefined;
    },
    enabled: !!tenant && !!me.data,
  });
}
export function useChatPresence() {
  return useQuery({
    queryKey: ['chat-presence', useTenantId()],
    queryFn: () => api<{ online_user_ids: string[] }>('/chat/presence'),
    refetchInterval: 30000,
  });
}
export function useChatRealtime(
  socket: Socket,
  tenant: string | null | undefined,
  userId: string | undefined,
) {
  const client = useQueryClient();
  useEffect(() => {
    if (!tenant || !userId) return;
    const seen = new Set<string>();
    const receive = ({ conversation_id, message }: ServerEvents['chat:message']) => {
      client.setQueryData<ChatPages>(['chat-messages', tenant, conversation_id, userId], (data) =>
        upsertChatMessage(data, message),
      );
      if (seen.has(message.id)) return;
      seen.add(message.id);
      if (seen.size > 500) seen.delete(seen.values().next().value!);
      const key = ['chat-conversations', tenant, userId],
        data = client.getQueryData<ChatConversation[]>(key);
      if (!data?.some((c) => c.id === conversation_id)) {
        void client.invalidateQueries({ queryKey: key });
        return;
      }
      client.setQueryData<ChatConversation[]>(key, (rows) =>
        rows
          ?.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  last_message: {
                    body: message.body,
                    sender_name: message.sender.full_name,
                    sender_id: message.sender_id,
                    created_at: message.created_at,
                    is_shared: !!message.shared_thread_id,
                    deleted: !!message.deleted_at,
                  },
                  unread_count: c.unread_count + (message.sender_id !== userId ? 1 : 0),
                }
              : c,
          )
          .sort((a, b) =>
            (b.last_message?.created_at ?? '').localeCompare(a.last_message?.created_at ?? ''),
          ),
      );
    };
    const updated = ({ conversation_id, message }: ServerEvents['chat:message-updated']) => {
      client.setQueryData<ChatPages>(['chat-messages', tenant, conversation_id, userId], (data) =>
        upsertChatMessage(data, message),
      );
      void client.invalidateQueries({ queryKey: ['chat-conversations', tenant, userId] });
    };
    const changed = () => {
      void client.invalidateQueries({ queryKey: ['chat-conversations', tenant, userId] });
    };
    const reconnect = () => {
      changed();
      void client.invalidateQueries({ queryKey: ['chat-messages', tenant] });
    };
    const presence = (data: ServerEvents['presence:changed']) =>
      client.setQueryData(['chat-presence', tenant], data);
    socket.on('chat:message', receive);
    socket.on('chat:message-updated', updated);
    socket.on('chat:conversations-changed', changed);
    socket.on('presence:changed', presence);
    socket.on('connect', reconnect);
    return () => {
      socket.off('chat:message', receive);
      socket.off('chat:message-updated', updated);
      socket.off('chat:conversations-changed', changed);
      socket.off('presence:changed', presence);
      socket.off('connect', reconnect);
    };
  }, [socket, tenant, userId, client]);
}
export function useChatTyping(id: string) {
  const socket = useContext(SocketContext),
    me = useQuery(meQuery),
    last = useRef(0),
    [typing, setTyping] = useState<{
      conversation_id: string;
      users: Record<string, { full_name: string; until: number }>;
    }>({ conversation_id: id, users: {} });
  useEffect(() => {
    if (!socket) return;
    const receive = (data: ServerEvents['chat:typing']) => {
      if (data.conversation_id !== id || data.user_id === me.data?.user.id) return;
      setTyping((current) => ({
        conversation_id: id,
        users: {
          ...(current.conversation_id === id ? current.users : {}),
          [data.user_id]: { full_name: data.full_name, until: Date.now() + 5000 },
        },
      }));
    };
    socket.on('chat:typing', receive);
    const timer = setInterval(
      () =>
        setTyping((current) => ({
          ...current,
          users: Object.fromEntries(
            Object.entries(current.users).filter(([, user]) => user.until > Date.now()),
          ),
        })),
      1000,
    );
    return () => {
      socket.off('chat:typing', receive);
      clearInterval(timer);
    };
  }, [socket, id, me.data?.user.id]);
  return {
    users:
      typing.conversation_id === id
        ? Object.values(typing.users).map((user) => user.full_name)
        : [],
    notify: () => {
      if (socket?.connected && Date.now() - last.current >= 3000) {
        last.current = Date.now();
        socket.emit('chat:typing', { conversation_id: id });
      }
    },
  };
}
