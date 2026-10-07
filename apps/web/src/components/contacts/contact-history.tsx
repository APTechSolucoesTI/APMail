import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ContactDetail, ListResult } from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/data/data-state';
type History = {
  thread_id: string;
  mailbox_id: string;
  mailbox_name: string;
  subject: string;
  message_at: string;
};
export function ContactHistory({ contact }: { contact: ContactDetail }) {
  const tenant = useTenantId(),
    me = useQuery(meQuery).data;
  const [email, setEmail] = useState(''),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['contact-history', tenant, me?.user.id, contact.id, email, page],
    queryFn: ({ signal }) =>
      api<ListResult<History>>(
        '/contacts/' +
          contact.id +
          '/history?' +
          new URLSearchParams({ ...(email ? { email } : {}), page: String(page), pageSize: '10' }),
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
            setPage(1);
          }}
        >
          <option value="">Todos os e-mails do contato</option>
          {contact.emails.map((e) => (
            <option key={e.email}>{e.email}</option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data?.items.length ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma conversa nas caixas e pastas que você pode acessar.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {q.data.items.map((h) => (
            <li key={h.thread_id}>
              <Link
                className="block space-y-1 p-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                to="/mail/$mailboxId"
                params={{ mailboxId: h.mailbox_id }}
                search={{ thread: h.thread_id }}
              >
                <span className="block break-words font-medium">{h.subject || 'Sem assunto'}</span>
                <span className="text-xs text-muted-foreground">
                  {h.mailbox_name} ·{' '}
                  {new Date(h.message_at).toLocaleString('pt-BR', {
                    timeZone: me?.preferences.timezone,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label="Paginação do histórico do contato"
        className="flex flex-wrap items-center justify-between gap-2 text-sm"
      >
        <span>
          {q.data?.total ?? 0} conversa(s) · Página {page} de{' '}
          {Math.max(1, Math.ceil((q.data?.total ?? 0) / 10))}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={page === 1 || q.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page * 10 >= (q.data?.total ?? 0) || q.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </nav>
    </section>
  );
}
