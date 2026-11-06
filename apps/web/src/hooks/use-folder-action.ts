import { useState, useEffect, useContext, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { SocketContext } from '@/hooks/use-socket-room';
import { flattenFolders, type Folder } from '@/lib/mail';

type Pending = {
  id: string;
  kind: 'create' | 'rename' | 'move' | 'delete';
  name: string;
  parentId: string | null;
  folderId?: string;
};
export function useFolderAction(mailboxId: string, folder?: Folder) {
  const client = useQueryClient(),
    socket = useContext(SocketContext),
    lock = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null),
    [enqueueing, setEnqueueing] = useState(false),
    [error, setError] = useState('');
  const enqueue = async (
    kind: Pending['kind'],
    name = '',
    parentId = folder?.parent_id ?? null,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setEnqueueing(true);
    try {
      const url =
        kind === 'create' ? '/mailboxes/' + mailboxId + '/folders' : '/folders/' + folder!.id;
      const result = await api<{ action_id: string }>(url, {
        method: kind === 'create' ? 'POST' : kind === 'delete' ? 'DELETE' : 'PATCH',
        ...(kind === 'delete'
          ? {}
          : {
              body:
                kind === 'create'
                  ? { name, parent_id: folder?.id ?? null }
                  : kind === 'move'
                    ? { name, parent_id: parentId }
                    : { name },
            }),
      });
      setPending({
        id: result.action_id,
        folderId: folder?.id,
        kind,
        name,
        parentId: kind === 'create' ? (folder?.id ?? null) : parentId,
      });
      setError('');
    } catch (error) {
      lock.current = false;
      throw error;
    } finally {
      setEnqueueing(false);
    }
  };
  useEffect(() => {
    if (!pending) return;
    let closed = false;
    const completed = () => {
      if (closed) return;
      closed = true;
      lock.current = false;
      setPending(null);
      void client.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Pasta atualizada no servidor.');
    };
    const check = async () => {
      try {
        const action = await api<{ status: string; error?: string | null }>(
          '/folder-actions/' + pending.id,
        );
        if (closed) return;
        if (action.status === 'failed') {
          closed = true;
          setError(action.error ?? 'Não foi possível alterar a pasta. Tente novamente.');
          lock.current = false;
          setPending(null);
          return;
        }
        if (action.status === 'done') {
          completed();
          return;
        }
        const rows = flattenFolders(await api<Folder[]>('/mailboxes/' + mailboxId + '/folders'));
        if (closed) return;
        const done =
          pending.kind === 'create'
            ? rows.some((f) => f.name === pending.name && f.parent_id === pending.parentId)
            : pending.kind === 'rename' || pending.kind === 'move'
              ? rows.some(
                  (f) =>
                    f.id === pending.folderId &&
                    f.name === pending.name &&
                    f.parent_id === pending.parentId,
                )
              : !rows.some((f) => f.id === pending.folderId);
        if (done) completed();
      } catch {
        /* Uma reconexão retomará a conferência. */
      }
    };
    const changed = (event: { action_id?: string; status?: string; error?: string }) => {
      if (!closed && event.action_id === pending.id) {
        if (event.status === 'failed') {
          closed = true;
          setError(event.error ?? 'Não foi possível alterar a pasta.');
          lock.current = false;
          setPending(null);
        } else if (event.status === 'done') completed();
      }
    };
    socket?.on('folders:changed', changed);
    const timer = setInterval(() => void check(), 5000);
    void check();
    return () => {
      closed = true;
      clearInterval(timer);
      socket?.off('folders:changed', changed);
    };
  }, [pending, mailboxId, socket, client]);
  return { enqueue, pending, busy: enqueueing || !!pending, error, setError };
}
