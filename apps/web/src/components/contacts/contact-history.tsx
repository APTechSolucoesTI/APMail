import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { listQuerySchema, type ContactDetail, type ListResult } from '@apmail/shared';
import { api } from '@/lib/api';
import { tableParameters } from '@/lib/table-query';
import { meQuery, useTenantId } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { ConfigurableTable } from '@/components/data/configurable-table';
type History = {
  id: string;
  thread_id: string;
  mailbox_id: string;
  mailbox_name: string;
  subject: string;
  message_at: string;
};
export function ContactHistory({ contact }: { contact: ContactDetail }) {
  const tenant = useTenantId(),
    me = useQuery(meQuery).data,
    [email, setEmail] = useState(''),
    [query, setQuery] = useState(listQuerySchema.parse({}));
  const q = useQuery({
    queryKey: ['contact-history', tenant, me?.user.id, contact.id, email, query],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api<ListResult<History>>(
        '/contacts/' +
          contact.id +
          '/history?' +
          new URLSearchParams({
            ...tableParameters(query),
            ...(email ? { email } : {}),
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
          }),
        { signal },
      ),
  });
  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="contact-history-email">Histórico por e-mail</Label>
        <select
          id="contact-history-email"
          className="h-11 w-full rounded-md border bg-card px-3 text-sm"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setQuery({ ...query, page: 1 });
          }}
        >
          <option value="">Todos os e-mails do contato</option>
          {contact.emails.map((e) => (
            <option key={e.email}>{e.email}</option>
          ))}
        </select>
      </div>
      <ConfigurableTable
        listKey="contact-history"
        mode="server"
        query={query}
        onQueryChange={setQuery}
        data={(q.data?.items ?? []).map((h) => ({ ...h, id: h.thread_id }))}
        total={q.data?.total ?? 0}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          {
            id: 'subject',
            header: 'Assunto',
            hideable: false,
            cell: (h) => (
              <Link
                to="/mail/$mailboxId"
                params={{ mailboxId: h.mailbox_id }}
                search={{ thread: h.thread_id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                {h.subject || 'Sem assunto'}
              </Link>
            ),
          },
          { id: 'mailbox_name', header: 'Caixa' },
          {
            id: 'message_at',
            header: 'Data e hora',
            cell: (h) =>
              new Date(h.message_at).toLocaleString('pt-BR', {
                timeZone: me?.preferences.timezone,
              }),
          },
        ]}
      />
    </section>
  );
}
