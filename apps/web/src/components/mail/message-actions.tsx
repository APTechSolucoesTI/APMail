import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderInput, Trash2, Undo2, Flag } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { flattenFolders, folderLabel, type Folder } from '@/lib/mail';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
export function MessageActions({
  mailboxId,
  folders,
  messageIds,
  threadIds,
  flagged,
  onDone,
}: {
  mailboxId: string;
  folders: Folder[];
  messageIds?: string[];
  threadIds?: string[];
  flagged?: boolean;
  onDone?: () => void;
}) {
  const client = useQueryClient(),
    [move, setMove] = useState(false),
    [folderId, setFolderId] = useState('');
  const mutation = useMutation({
    mutationFn: (b: { type: string; target_folder_id?: string; flagged?: boolean }) =>
      api('/mailboxes/' + mailboxId + '/messages/actions', {
        method: 'POST',
        body: { message_ids: messageIds, thread_ids: threadIds, ...b },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['threads'] });
      await client.invalidateQueries({ queryKey: ['thread'] });
      setMove(false);
      onDone?.();
      toast.success('Aplicando alteração no servidor…');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => setMove(true)}>
        <FolderInput />
        Mover
      </Button>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="ghost" disabled={mutation.isPending}>
            <Trash2 />
            Excluir
          </Button>
        }
        title="Excluir mensagens?"
        description={`${threadIds ? threadIds.length + ' conversa(s)' : messageIds?.length + ' mensagem(ns)'} serão movidas para a Lixeira. Mensagens que já estão na Lixeira serão excluídas definitivamente.`}
        onConfirm={() => mutation.mutateAsync({ type: 'delete' })}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ type: 'restore' })}
      >
        <Undo2 />
        Restaurar
      </Button>
      {flagged !== undefined && (
        <Button
          size="sm"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ type: 'set_flag', flagged: !flagged })}
        >
          <Flag />
          {flagged ? 'Remover sinalização' : 'Sinalizar'}
        </Button>
      )}
      <Dialog open={move} onOpenChange={setMove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover mensagens</DialogTitle>
            <DialogDescription>Escolha uma pasta desta caixa.</DialogDescription>
          </DialogHeader>
          <label htmlFor="target-folder" className="text-sm font-medium">
            Pasta de destino
          </label>
          <select
            id="target-folder"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            className="h-11 rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="">Selecione uma pasta</option>
            {flattenFolders(folders).map((f) => (
              <option value={f.id} key={f.id}>
                {folderLabel(f)}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMove(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!folderId || mutation.isPending}
              onClick={() => mutation.mutate({ type: 'move', target_folder_id: folderId })}
            >
              {mutation.isPending ? 'Aplicando…' : 'Mover'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
