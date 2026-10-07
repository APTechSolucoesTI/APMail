import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ContactDetail } from '@apmail/shared';
import { api } from '@/lib/api';
import { canMailbox, useTenantId, type Mailbox } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export function ContactSendDialog({
  contact,
  onClose,
}: {
  contact: ContactDetail;
  onClose: () => void;
}) {
  const tenant = useTenantId(),
    navigate = useNavigate();
  const q = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const boxes = q.data?.filter((b) => canMailbox(b, 'send') && b.status === 'active') ?? [];
  const [recipient, setRecipient] = useState(
    contact.emails.find((e) => e.is_primary)?.email ?? contact.emails[0]?.email ?? '',
  );
  const [sender, setSender] = useState('');
  const mailbox = sender || (boxes.length === 1 ? boxes[0]!.id : '');
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar novo e-mail</DialogTitle>
          <DialogDescription>Escolha o destinatário e a caixa que fará o envio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="contact-recipient">Destinatário</Label>
          <select
            id="contact-recipient"
            className="h-11 w-full rounded-md border bg-card px-3 text-sm"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            {contact.emails.map((e) => (
              <option key={e.email} value={e.email}>
                {e.email}
                {e.is_primary ? ' · Principal' : ''}
              </option>
            ))}
          </select>
        </div>
        {q.isLoading ? (
          <LoadingState />
        ) : q.error ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="contact-sender">Caixa remetente</Label>
            <select
              id="contact-sender"
              className="h-11 w-full rounded-md border bg-card px-3 text-sm"
              value={mailbox}
              onChange={(e) => setSender(e.target.value)}
            >
              <option value="">Escolha uma caixa</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} &lt;{b.email_address}&gt;
                </option>
              ))}
            </select>
            {!boxes.length && (
              <p role="status" className="text-sm text-muted-foreground">
                Você não tem uma caixa ativa com permissão de envio.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!mailbox || !recipient || q.isLoading || !!q.error}
            onClick={() =>
              void navigate({
                to: '/mail/$mailboxId',
                params: { mailboxId: mailbox },
                search: { compose: 'new', toEmail: recipient, toName: contact.name },
              })
            }
          >
            Abrir mensagem
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
