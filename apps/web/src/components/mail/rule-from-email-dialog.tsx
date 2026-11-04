import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeRuleEmail, uniqueAddresses } from '@apmail/shared';
import { z } from 'zod';
import { toast } from 'sonner';
import { canMailbox, useAccess, type Mailbox } from '@/lib/auth';
import type { Message, Thread } from '@/lib/mail';
import type { MailRule } from '@/lib/organization';
import { createRuleDraft } from '@/lib/rule-draft';
import { RuleEditor } from '@/components/settings/rule-editor';
import { selectClass } from '@/components/settings/rule-options';
import { NoPermissionState } from '@/components/data/data-state';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function RuleFromEmailDialog({
  mailbox,
  thread,
  message,
  onClose,
}: {
  mailbox: Mailbox;
  thread: Thread;
  message?: Message;
  onClose: () => void;
}) {
  const client = useQueryClient(),
    id = useId();
  const mayCreate = useAccess('rules') && canMailbox(mailbox, 'read');
  const mayManageMailbox = mayCreate && canMailbox(mailbox, 'rules');
  const from = message
    ? { name: message.from_name, address: message.from_address }
    : thread.latest_from;
  const direction = message?.direction ?? thread.direction;
  const outbound = direction
    ? direction === 'outbound'
    : [mailbox.email_address, ...mailbox.aliases].some(
        (address) => normalizeRuleEmail(address) === normalizeRuleEmail(from.address),
      );
  const recipients = uniqueAddresses(
    (message?.to_addresses ?? thread.latest_to ?? []).map((address) => ({
      ...address,
      address: normalizeRuleEmail(address.address),
    })),
  ).filter((address) => z.email().safeParse(address.address).success);
  const [recipient, setRecipient] = useState('');
  const selected = recipients.find((address) => address.address === recipient) ?? recipients[0];
  const address = outbound ? (selected?.address ?? '') : normalizeRuleEmail(from.address);
  const validAddress = z.email().safeParse(address).success;
  const [requestedScope, setScope] = useState<MailRule['scope']>('personal');
  const scope = mayManageMailbox ? requestedScope : 'personal';
  const rule = {
    ...createRuleDraft(mailbox.id, scope),
    name: ('E-mails ' + (outbound ? 'para ' : 'de ') + address).slice(0, 80),
    conditions: [
      {
        field: outbound ? ('to' as const) : ('from' as const),
        operator: 'equals' as const,
        value: address,
      },
    ],
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex min-h-0 w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {outbound ? 'Criar regra deste destinatário' : 'Criar regra deste remetente'}
          </SheetTitle>
          <SheetDescription>
            Confira as condições e escolha as ações. Mensagens existentes só serão afetadas se você
            marcar essa opção ao salvar.
          </SheetDescription>
        </SheetHeader>
        {!mayCreate ? (
          <NoPermissionState />
        ) : !validAddress ? (
          <div className="space-y-3 p-4">
            <p role="alert" className="text-sm text-destructive">
              Não foi possível identificar um endereço válido neste e-mail. Selecione outra mensagem
              para criar a regra.
            </p>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
          <>
            {(mayManageMailbox || (outbound && recipients.length > 1)) && (
              <div className="grid shrink-0 gap-3 border-b px-4 pb-4 sm:grid-cols-2">
                {outbound && recipients.length > 1 && (
                  <div className="space-y-2">
                    <Label htmlFor={id + '-recipient'}>Destinatário da regra</Label>
                    <select
                      id={id + '-recipient'}
                      className={selectClass}
                      value={address}
                      onChange={(event) => setRecipient(event.target.value)}
                    >
                      {recipients.map((item) => (
                        <option key={item.address} value={item.address}>
                          {item.name ? item.name + ' — ' : ''}
                          {item.address}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {mayManageMailbox && (
                  <div className="space-y-2">
                    <Label htmlFor={id + '-scope'}>Escopo da regra</Label>
                    <select
                      id={id + '-scope'}
                      className={selectClass}
                      value={scope}
                      onChange={(event) => {
                        if (event.target.value === 'personal' || event.target.value === 'mailbox')
                          setScope(event.target.value);
                      }}
                    >
                      <option value="personal">Minha regra pessoal</option>
                      <option value="mailbox">Regra da caixa compartilhada</option>
                    </select>
                  </div>
                )}
              </div>
            )}
            <RuleEditor
              key={scope + ':' + address}
              rule={rule}
              boxes={[mailbox]}
              onClose={onClose}
              onSaved={async () => {
                await client.invalidateQueries({ queryKey: ['rules'] });
                toast.success('Regra salva.');
                onClose();
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
