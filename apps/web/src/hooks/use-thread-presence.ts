import { useContext, useEffect, useState } from 'react';
import { SocketContext } from './use-socket-room';
type Presence = {
  thread_id: string;
  users: { user_id: string; full_name: string; composing: boolean }[];
};
export function useThreadPresence(threadId: string) {
  const socket = useContext(SocketContext),
    [presence, setPresence] = useState<Presence | null>(null);
  useEffect(() => {
    if (!socket) return;
    const receive = (p: Presence) => {
      if (p.thread_id === threadId) setPresence(p);
    };
    socket.on('thread:presence', receive);
    return () => {
      socket.off('thread:presence', receive);
    };
  }, [socket, threadId]);
  return presence?.thread_id === threadId ? presence.users : [];
}
export function useComposingPresence(threadId: string | null | undefined, enabled: boolean) {
  const socket = useContext(SocketContext);
  useEffect(() => {
    if (!socket || !threadId || !enabled) return;
    const heartbeat = () =>
      socket.emit('thread:composing', { thread_id: threadId, composing: true });
    heartbeat();
    socket.on('connect', heartbeat);
    const timer = setInterval(heartbeat, 20000);
    return () => {
      clearInterval(timer);
      socket.off('connect', heartbeat);
      socket.emit('thread:composing', { thread_id: threadId, composing: false });
    };
  }, [socket, threadId, enabled]);
}
