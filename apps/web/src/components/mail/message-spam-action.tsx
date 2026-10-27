import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ellipsis, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAccess } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function MessageSpamAction({
  mailboxId,
  messageId,
  sender,
}: {
  mailboxId: string;
  messageId: string;
  sender: string;
}) {
  const mayMove = useAccess('mail.move'),
    mayRule = useAccess('rules');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const client = useQueryClient();
  if (!mayMove || !mayRule) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="ghost" size="sm" aria-label="Mais ações da mensagem">
            <Ellipsis aria-hidden /> Mais ações
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <ShieldAlert aria-hidden /> Marcar como spam
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={trigger}
        title="Marcar como spam?"
        description={`Esta mensagem será movida para Spam. Os próximos e-mails de ${sender} também irão para Spam nesta caixa. Você pode desativar esse filtro em Configurações > Regras.`}
        onConfirm={async () => {
          await api('/mailboxes/' + mailboxId + '/messages/actions', {
            method: 'POST',
            body: { type: 'spam', message_ids: [messageId] },
          });
          await Promise.all([
            client.invalidateQueries({ queryKey: ['threads'] }),
            client.invalidateQueries({ queryKey: ['thread'] }),
            client.invalidateQueries({ queryKey: ['folders'] }),
            client.invalidateQueries({ queryKey: ['rules'] }),
            client.invalidateQueries({ queryKey: ['queue-counts'] }),
          ]);
          toast.success('Mensagem marcada como spam. Filtro de remetente ativado nesta caixa.');
        }}
      />
    </>
  );
}
