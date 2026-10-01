import { createContext, useContext, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
export const SocketContext = createContext<Socket | null>(null);
export function useSocketRoom(type: 'mailbox' | 'thread', id: string | undefined) {
  const socket = useContext(SocketContext);
  useEffect(() => {
    if (!socket || !id) return;
    const join = () => socket.emit(type + ':subscribe', { [type + '_id']: id });
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      socket.emit('room:unsubscribe', { type, id });
    };
  }, [socket, type, id]);
}
