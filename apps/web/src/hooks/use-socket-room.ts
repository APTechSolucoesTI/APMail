import { createContext, useContext, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTenantId } from '@/lib/auth';
export const SocketContext = createContext<Socket | null>(null);
// A mailbox route, the sidebar and folder controls can share the same room.
// Socket.IO membership is per connection, so only the last consumer may leave.
const roomSubscriptions = new WeakMap<Socket, Map<string, { users: number; leave: () => void }>>();
export function useSocketRoom(type: 'mailbox' | 'thread' | 'chat', id: string | undefined) {
  const socket = useContext(SocketContext);
  const client = useQueryClient(),
    tenant = useTenantId();
  useEffect(() => {
    if (!socket || !id) return;
    let rooms = roomSubscriptions.get(socket);
    if (!rooms) {
      rooms = new Map();
      roomSubscriptions.set(socket, rooms);
    }
    const roomKey = `${tenant}:${type}:${id}`;
    const existing = rooms.get(roomKey);
    if (existing) {
      existing.users++;
      return () => {
        existing.users--;
        if (existing.users === 0) {
          existing.leave();
          rooms.delete(roomKey);
        }
      };
    }
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
    const subscription = {
      users: 1,
      leave: () => {
        socket.off('connect', join);
        socket.emit(type + ':leave', { [type === 'chat' ? 'conversation_id' : type + '_id']: id });
      },
    };
    rooms.set(roomKey, subscription);
    socket.on('connect', join);
    join();
    return () => {
      subscription.users--;
      if (subscription.users === 0) {
        subscription.leave();
        rooms.delete(roomKey);
      }
    };
  }, [socket, type, id, client, tenant]);
}
