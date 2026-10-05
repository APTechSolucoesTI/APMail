import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderInput, Trash2, Undo2, Flag, ChevronDown } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
export function MessageActions({
  mailboxId,
  folders,
  messageIds,
  threadIds,
  flagged,
  onDone,
  compact = false,
}: {
  mailboxId: string;
  folders: Folder[];
  messageIds?: string[];
  threadIds?: string[];
  flagged?: boolean;
  onDone?: () => void;
  compact?: boolean;
}) {
  const client = useQueryClient(),
    [move, setMove] = useState(false),
    [remove, setRemove] = useState(false),
    [folderId, setFolderId] = useState('');
  const moveTrigger = useRef<HTMLButtonElement>(null),
    removeTrigger = useRef<HTMLButtonElement>(null);
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
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              ref={(node) => {
                moveTrigger.current = node;
                removeTrigger.current = node;
              }}
            >
              <FolderInput />
              Organizar
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setMove(true)}>
              <FolderInput /> Mover para pasta
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => mutation.mutate({ type: 'restore' })}>
              <Undo2 /> Restaurar
            </DropdownMenuItem>
            {flagged !== undefined && (
              <DropdownMenuItem
                onSelect={() => mutation.mutate({ type: 'set_flag', flagged: !flagged })}
              >
                <Flag /> {flagged ? 'Remover sinalização' : 'Sinalizar'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setRemove(true)}>
              <Trash2 /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button
            ref={moveTrigger}
            size="sm"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => setMove(true)}
          >
            <FolderInput />
            Mover
          </Button>
          <Button
            ref={removeTrigger}
            size="sm"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => setRemove(true)}
          >
            <Trash2 />
            Excluir
          </Button>
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
        </>
      )}
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        returnFocusRef={removeTrigger}
        destructive
        pending={mutation.isPending}
        title="Excluir mensagens?"
        description={`${threadIds ? threadIds.length + ' conversa(s)' : messageIds?.length + ' mensagem(ns)'} serão movidas para a Lixeira. Mensagens que já estão na Lixeira serão excluídas definitivamente.`}
        onConfirm={() => mutation.mutateAsync({ type: 'delete' })}
      />
      <Dialog open={move} onOpenChange={setMove}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            moveTrigger.current?.focus();
          }}
        >
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
