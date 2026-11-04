import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderInput, Trash2, Undo2, Flag, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAccess } from '@/lib/auth';
import { type Folder } from '@/lib/mail';
import { FolderDestinationPicker, type FolderDestination } from './folder-destination-picker';
import { Button } from '@/components/ui/button';
import { MailActionButton } from './mail-action-button';
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
  inTrash = false,
  iconOnly = true,
}: {
  mailboxId: string;
  folders: Folder[];
  messageIds?: string[];
  threadIds?: string[];
  flagged?: boolean;
  onDone?: () => void;
  compact?: boolean;
  inTrash?: boolean;
  iconOnly?: boolean;
}) {
  const mayMove = useAccess('mail.move'),
    mayDelete = useAccess('mail.delete'),
    mayRestore = useAccess('mail.restore') && inTrash,
    mayFlag = useAccess('mail.flag');
  const client = useQueryClient(),
    [move, setMove] = useState(false),
    [remove, setRemove] = useState(false),
    [destination, setDestination] = useState<FolderDestination | null>(null);
  const moveTrigger = useRef<HTMLButtonElement>(null),
    removeTrigger = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({
    mutationFn: (b: {
      type: string;
      target_folder_id?: string;
      target_mailbox_id?: string;
      flagged?: boolean;
    }) =>
      api('/mailboxes/' + mailboxId + '/messages/actions', {
        method: 'POST',
        body: { message_ids: messageIds, thread_ids: threadIds, ...b },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['threads'] });
      await client.invalidateQueries({ queryKey: ['thread'] });
      await client.invalidateQueries({ queryKey: ['folders'] });
      await client.invalidateQueries({ queryKey: ['queue-counts'] });
      setMove(false);
      setDestination(null);
      onDone?.();
      toast.success('Aplicando alteração no servidor…');
    },
    onError: (e) => toast.error(e.message),
  });
  if (!mayMove && !mayDelete && !mayRestore && !(mayFlag && flagged !== undefined)) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {iconOnly ? (
              <MailActionButton
                label="Organizar"
                disabled={mutation.isPending}
                ref={(node) => {
                  moveTrigger.current = node;
                  removeTrigger.current = node;
                }}
              >
                <FolderInput />
              </MailActionButton>
            ) : (
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
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {mayMove && (
              <DropdownMenuItem onSelect={() => setMove(true)}>
                <FolderInput /> Mover para pasta
              </DropdownMenuItem>
            )}
            {mayRestore && (
              <DropdownMenuItem onSelect={() => mutation.mutate({ type: 'restore' })}>
                <Undo2 /> Restaurar
              </DropdownMenuItem>
            )}
            {mayFlag && flagged !== undefined && (
              <DropdownMenuItem
                onSelect={() => mutation.mutate({ type: 'set_flag', flagged: !flagged })}
              >
                <Flag /> {flagged ? 'Remover sinalização' : 'Sinalizar'}
              </DropdownMenuItem>
            )}
            {mayDelete && (
              <>
                {(mayMove || mayRestore || (mayFlag && flagged !== undefined)) && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem variant="destructive" onSelect={() => setRemove(true)}>
                  <Trash2 /> Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          {mayMove && (
            <MailActionButton
              label="Mover"
              text="Mover para pasta"
              ref={moveTrigger}
              disabled={mutation.isPending}
              onClick={() => setMove(true)}
            >
              <FolderInput />
            </MailActionButton>
          )}
          {mayDelete && (
            <MailActionButton
              label="Excluir"
              ref={removeTrigger}
              disabled={mutation.isPending}
              onClick={() => setRemove(true)}
            >
              <Trash2 />
            </MailActionButton>
          )}
          {mayRestore && (
            <MailActionButton
              label="Restaurar"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ type: 'restore' })}
            >
              <Undo2 />
            </MailActionButton>
          )}
          {mayFlag && flagged !== undefined && (
            <MailActionButton
              label={flagged ? 'Remover sinalização' : 'Sinalizar'}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ type: 'set_flag', flagged: !flagged })}
            >
              <Flag />
            </MailActionButton>
          )}
        </>
      )}
      <ConfirmDialog
        open={remove && mayDelete}
        onOpenChange={setRemove}
        returnFocusRef={removeTrigger}
        destructive
        pending={mutation.isPending}
        title="Excluir mensagens?"
        description={`${threadIds ? threadIds.length + ' conversa(s)' : messageIds?.length + ' mensagem(ns)'} serão movidas para a Lixeira. Mensagens que já estão na Lixeira serão excluídas definitivamente.`}
        onConfirm={() => mutation.mutateAsync({ type: 'delete' })}
      />
      <Dialog open={move && mayMove} onOpenChange={setMove}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            moveTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Mover mensagens</DialogTitle>
            <DialogDescription>
              Navegue pelas pastas ou escolha outra caixa com acesso para mover.
            </DialogDescription>
          </DialogHeader>
          {move && (
            <FolderDestinationPicker
              mailboxId={mailboxId}
              folders={folders}
              value={destination}
              onChange={setDestination}
              allowMailboxChange
              disabled={mutation.isPending}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMove(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!destination?.folderId || mutation.isPending}
              onClick={() =>
                destination?.folderId &&
                mutation.mutate({
                  type: 'move',
                  target_folder_id: destination.folderId,
                  ...(destination.mailboxId !== mailboxId
                    ? { target_mailbox_id: destination.mailboxId }
                    : {}),
                })
              }
            >
              {mutation.isPending ? 'Aplicando…' : 'Mover'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
