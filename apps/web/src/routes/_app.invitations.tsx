import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Bell } from 'lucide-react';
import { useTenantId } from '@/lib/auth';
import { threadInvitationsQuery } from '@/components/mail/thread-invitations';
import { ThreadView } from '@/components/mail/thread-view';
import { Composer } from '@/components/mail/composer';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
export const Route = createFileRoute('/_app/invitations')({
  validateSearch: z.object({ thread: z.uuid().optional() }),
  component: InvitationsPage,
});
function InvitationsPage() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenant = useTenantId();
  const q = useQuery(threadInvitationsQuery(tenant));
  const [compose, setCompose] = useState<string | null>(null);
  const active = q.data?.filter((item) => item.state === 'active') ?? [];
  const invitation = active.find((item) => item.thread_id === search.thread);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Bell className="size-6 text-primary" />
          Convites
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversas compartilhadas com você durante o atendimento.
        </p>
      </header>
      <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card">
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : invitation ? (
          <ThreadView
            key={invitation.thread_id}
            threadId={invitation.thread_id}
            mailboxId={invitation.mailbox_id}
            folders={[]}
            onClose={() => {
              setCompose(null);
              void navigate({ search: {} });
            }}
            onCompose={setCompose}
          />
        ) : search.thread ? (
          <EmptyState
            title="Convite encerrado"
            description="Este atendimento foi concluído ou o convite foi encerrado."
            action={
              <Button variant="outline" onClick={() => void navigate({ search: {} })}>
                Voltar aos convites
              </Button>
            }
          />
        ) : !active.length ? (
          <EmptyState
            title="Nenhum convite ativo"
            description="As conversas para as quais você for convidado aparecerão aqui."
          />
        ) : (
          <ul className="divide-y">
            {active.map((item) => (
              <li key={item.id}>
                <button
                  className="flex min-h-20 w-full flex-col gap-1 p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void navigate({ search: { thread: item.thread_id } })}
                >
                  <span className="font-semibold">{item.subject || '(Sem assunto)'}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.mailbox_name} · {item.mailbox_email}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Convidado por {item.inviter_name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {compose && invitation && (
        <Composer
          key={invitation.thread_id + compose}
          mailboxId={invitation.mailbox_id}
          threadId={invitation.thread_id}
          mode={compose}
          onClose={() => setCompose(null)}
          onReopen={(id) => setCompose('draft:' + id)}
        />
      )}
    </div>
  );
}
