import { createContext, useContext, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTenantId } from '@/lib/auth';
export const SocketContext = createContext<Socket | null>(null);
export function useSocketRoom(type: 'mailbox' | 'thread' | 'chat', id: string | undefined) {
  const socket = useContext(SocketContext);
  const client = useQueryClient(),
    tenant = useTenantId();
  useEffect(() => {
    if (!socket || !id) return;
    const join = () =>
      socket.emit(
        type + ':join',
        { [type === 'chat' ? 'conversation_id' : type + '_id']: id },
        (ack: { ok?: boolean; error?: string }) => {
          if (!ack.ok) return;
          // Fecha a janela entre a consulta inicial e a entrada efetiva na sala.
          for (const key of type === 'thread'
            ? ['thread', 'thread-notes', 'thread-history']
            : type === 'chat'
              ? ['chat-messages']
              : ['threads', 'queue-counts', 'folders'])
            void client.invalidateQueries({ queryKey: [key, tenant, id] });
        },
      );
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      socket.emit(type + ':leave', { [type === 'chat' ? 'conversation_id' : type + '_id']: id });
    };
  }, [socket, type, id, client, tenant]);
}
