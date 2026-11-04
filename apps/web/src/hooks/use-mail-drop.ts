import { useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAccess } from '@/lib/auth';
import { MAIL_DRAG_TYPE, readMailDrag, activeMailDrag, MAIL_MOVED_EVENT } from '@/lib/mail-drag';
export function useMailDrop(mailboxId: string, folderId: string, enabled: boolean) {
  const [over, setOver] = useState(false),
    [busy, setBusy] = useState(false),
    lock = useRef(false);
  const mayMove = useAccess('mail.move'),
    client = useQueryClient();
  return {
    over,
    busy,
    handlers: {
      onDragOver: (event: DragEvent) => {
        const drag = activeMailDrag();
        if (
          !enabled ||
          !mayMove ||
          busy ||
          !event.dataTransfer.types.includes(MAIL_DRAG_TYPE) ||
          drag?.kind !== 'messages'
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: async (event: DragEvent) => {
        setOver(false);
        const payload = readMailDrag(event.dataTransfer);
        if (payload?.kind !== 'messages') return;
        event.preventDefault();
        event.stopPropagation();
        if (!enabled || !mayMove || lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          await api('/mailboxes/' + payload.mailboxId + '/messages/actions', {
            method: 'POST',
            body: {
              type: 'move',
              target_folder_id: folderId,
              target_mailbox_id: mailboxId,
              ...(payload.messageIds.length
                ? { message_ids: payload.messageIds }
                : { thread_ids: payload.threadIds }),
            },
          });
          window.dispatchEvent(new CustomEvent(MAIL_MOVED_EVENT, { detail: payload }));
          await Promise.all(
            ['threads', 'thread', 'folders', 'queue-counts'].map((key) =>
              client.invalidateQueries({ queryKey: [key] }),
            ),
          );
          toast.success(
            'Movimentação solicitada. Os e-mails aparecerão no destino após a sincronização.',
          );
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Não foi possível mover os e-mails.',
          );
        } finally {
          lock.current = false;
          setBusy(false);
        }
      },
    },
  };
}
