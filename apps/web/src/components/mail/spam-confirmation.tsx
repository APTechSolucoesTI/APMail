import type { RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

export function SpamConfirmation({
  mailboxId,
  messageIds,
  sender,
  onClose,
  returnFocusRef,
}: {
  mailboxId: string;
  messageIds: string[];
  sender: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const client = useQueryClient();
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      returnFocusRef={returnFocusRef}
      title="Marcar como spam?"
      description={`Os e-mails de ${sender} nesta conversa serão movidos para Spam. Os próximos e-mails desse remetente também irão para Spam nesta caixa. Você pode desativar esse filtro em Configurações > Regras.`}
      onConfirm={async () => {
        await api('/mailboxes/' + mailboxId + '/messages/actions', {
          method: 'POST',
          body: { type: 'spam', message_ids: messageIds },
        });
        await Promise.all([
          client.invalidateQueries({ queryKey: ['threads'] }),
          client.invalidateQueries({ queryKey: ['thread'] }),
          client.invalidateQueries({ queryKey: ['folders'] }),
          client.invalidateQueries({ queryKey: ['rules'] }),
          client.invalidateQueries({ queryKey: ['queue-counts'] }),
        ]);
        toast.success('Remetente marcado como spam nesta caixa.');
      }}
    />
  );
}
