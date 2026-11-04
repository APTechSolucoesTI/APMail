import { Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';

export function EmptyTrashButton({ mailboxId, folderId }: { mailboxId: string; folderId: string }) {
  const client = useQueryClient();
  return (
    <ConfirmDialog
      destructive
      trigger={
        <Button variant="outline">
          <Trash2 /> Esvaziar lixeira
        </Button>
      }
      title="Esvaziar a lixeira?"
      description="As mensagens desta pasta serão removidas da Lixeira e ficarão disponíveis para recuperação administrativa durante o prazo da empresa."
      onConfirm={async () => {
        let removed = 0;
        try {
          let more: boolean;
          do {
            const result = await api<{ affected: number; has_more: boolean }>(
              '/mailboxes/' + mailboxId + '/messages/actions',
              { method: 'POST', body: { type: 'delete', trash_folder_id: folderId } },
            );
            removed += result.affected;
            more = result.has_more && result.affected > 0;
          } while (more);
          toast.success(
            removed
              ? 'Mensagens encaminhadas para retenção.'
              : 'Nenhuma mensagem disponível para remover.',
          );
        } catch (error) {
          if (removed) toast.info(removed + ' mensagens já foram encaminhadas para retenção.');
          throw error;
        } finally {
          for (const key of ['threads', 'thread', 'folders', 'queue-counts', 'mail-retention'])
            void client.invalidateQueries({ queryKey: [key] });
        }
      }}
    />
  );
}
