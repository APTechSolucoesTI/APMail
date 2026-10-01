import { useTenantId } from '@/lib/auth';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Mailbox } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { MailboxStatusBadge } from '@/components/common/status-badge';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export const Route = createFileRoute('/_app/mail/$mailboxId')({ component: Mail });
function Mail() {
  const { mailboxId } = Route.useParams();
  const q = useQuery({
    queryKey: ['mailbox', useTenantId(), mailboxId],
    queryFn: () => api<Mailbox>('/mailboxes/' + mailboxId),
  });
  if (q.isLoading) return <LoadingState />;
  if (!q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader title={q.data.name} description={q.data.email_address} />
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <MailboxStatusBadge status={q.data.status} />
        <p role="status" className="text-sm text-muted-foreground">
          {q.data.status === 'pending'
            ? 'Verificando conexão…'
            : q.data.status === 'disabled'
              ? 'Esta caixa está desativada.'
              : 'A sincronização será disponibilizada na próxima fase.'}
        </p>
      </section>
    </>
  );
}
