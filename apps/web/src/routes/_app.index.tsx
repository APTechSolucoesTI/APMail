import { useTenantId } from '@/lib/auth';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { type Mailbox } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { MailboxStatusBadge } from '@/components/common/status-badge';
import { EmptyState, LoadingState, ErrorState } from '@/components/data/data-state';
export const Route = createFileRoute('/_app/')({ component: Home });
function Home() {
  const boxes = useQuery({
    queryKey: ['mailboxes', useTenantId()],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  return (
    <>
      <PageHeader
        title="Suas caixas de e-mail"
        description="Selecione uma caixa para acompanhar o atendimento."
      />
      {boxes.isLoading ? (
        <LoadingState />
      ) : boxes.error ? (
        <ErrorState onRetry={() => void boxes.refetch()} />
      ) : !boxes.data?.length ? (
        <EmptyState
          title="Nenhuma caixa disponível"
          description="O administrador pode conectar uma caixa e liberar seu acesso."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {boxes.data.map((b) => (
            <Link
              key={b.id}
              to="/mail/$mailboxId"
              params={{ mailboxId: b.id }}
              className="space-y-3 rounded-lg border bg-card p-4 shadow-card hover:border-primary"
            >
              <h2 className="text-xl font-semibold">{b.name}</h2>
              <p className="break-all text-sm text-muted-foreground">{b.email_address}</p>
              <MailboxStatusBadge status={b.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
