import { useState } from 'react';
import { History, Send } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ContactDetail } from '@apmail/shared';
import { meQuery, useAccess } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ContactSendDialog } from './contact-send';
import { ContactHistory } from './contact-history';

export function ContactReadOnly({
  contact,
  onClose,
}: {
  contact: ContactDetail;
  onClose: () => void;
}) {
  const canSend = useAccess('mail.send'),
    canReadMail = useAccess('mail');
  const timezone = useQuery(meQuery).data?.preferences.timezone;
  const [sending, setSending] = useState(false),
    [history, setHistory] = useState(false);
  const fields = [
    ['Nome completo', contact.name],
    ['Meu apelido (privado)', contact.nickname],
    ['Empresa', contact.company],
    ['Cargo', contact.job_title],
    ['Nome', contact.first_name],
    ['Nome do meio', contact.middle_name],
    ['Sobrenome', contact.last_name],
    ['Prefixo', contact.prefix],
    ['Sufixo', contact.suffix],
    ['Departamento', contact.department],
    ['Escritório', contact.office],
    ['Site', contact.website],
    ['Aniversário', contact.birthday],
  ];
  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {contact.scope === 'personal'
              ? 'Individual: visível somente para você'
              : 'Global: compartilhado com a empresa'}{' '}
            · Somente consulta
          </p>
          {canSend && contact.emails.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSending(true)}>
              <Send className="size-4" />
              Enviar novo e-mail
            </Button>
          )}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          {fields
            .filter(([, value]) => !!value)
            .map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words text-sm">{value}</dd>
              </div>
            ))}
        </dl>
        <div className="grid gap-5 sm:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">E-mails</h3>
            {contact.emails.length ? (
              <ul className="space-y-2">
                {contact.emails.map((email) => (
                  <li key={email.email} className="break-all text-sm">
                    {email.email}
                    {(email.label || email.is_primary) && (
                      <span className="block text-xs text-muted-foreground">
                        {[email.label, email.is_primary ? 'Principal' : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum e-mail cadastrado.</p>
            )}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Telefones</h3>
            {contact.phones.length ? (
              <ul className="space-y-2">
                {contact.phones.map((phone) => (
                  <li key={phone.number} className="text-sm">
                    {phone.number}
                    {(phone.label || phone.is_primary) && (
                      <span className="block text-xs text-muted-foreground">
                        {[phone.label, phone.is_primary ? 'Principal' : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {contact.phone || 'Nenhum telefone cadastrado.'}
              </p>
            )}
          </section>
        </div>
        {contact.addresses.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Endereços</h3>
            {contact.addresses.map((address, index) => (
              <div key={index} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {address.type === 'home'
                    ? 'Residencial'
                    : address.type === 'work'
                      ? 'Comercial'
                      : 'Outro'}
                </p>
                <p>
                  {[address.street, address.number, address.complement].filter(Boolean).join(', ')}
                </p>
                <p>{[address.district, address.city, address.state].filter(Boolean).join(' · ')}</p>
                <p>{[address.cep, address.country].filter(Boolean).join(' · ')}</p>
              </div>
            ))}
          </section>
        )}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Observações</h3>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {contact.notes || 'Sem observações.'}
          </p>
        </section>
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            Criado por {contact.created_by_name} em{' '}
            {new Date(contact.created_at).toLocaleString('pt-BR', { timeZone: timezone })}
          </p>
          <p>
            Última alteração por {contact.updated_by_name} em{' '}
            {new Date(contact.updated_at).toLocaleString('pt-BR', { timeZone: timezone })}
          </p>
        </div>
        {canReadMail && (
          <details
            className="rounded-md border p-3"
            onToggle={(event) => setHistory(event.currentTarget.open)}
          >
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 text-sm font-medium">
              <History className="size-4" />
              Histórico de e-mails
            </summary>
            {history && <ContactHistory contact={contact} />}
          </details>
        )}
      </div>
      <footer className="flex shrink-0 justify-end border-t p-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </footer>
      {sending && <ContactSendDialog contact={contact} onClose={() => setSending(false)} />}
    </>
  );
}
