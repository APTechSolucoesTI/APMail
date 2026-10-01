import { useTenantId } from '@/lib/auth';
import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listQuerySchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { MailboxStatusBadge } from '@/components/common/status-badge';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MailboxWizard } from '@/components/forms/mailbox-wizard';
import { api } from '@/lib/api';
import { type Mailbox } from '@/lib/auth';
import { requireAdmin } from '@/lib/settings';
import { Plus, Settings, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
export const Route = createFileRoute('/_app/settings/mailboxes')({
  beforeLoad: requireAdmin,
  validateSearch: listQuerySchema,
  component: Mailboxes,
});
function Mailboxes() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const query = Route.useSearch();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['mailboxes-settings', useTenantId()],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const action = async (id: string, name: string) => {
    await api('/mailboxes/' + id + '/' + name, { method: 'POST' });
    await client.invalidateQueries();
  };
  return (
    <>
      <PageHeader
        title="Caixas de e-mail"
        description="Conecte servidores IMAP/SMTP e distribua os acessos."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            Conectar caixa
          </Button>
        }
      />
      <ConfigurableTable
        listKey="mailboxes"
        mode="client"
        columns={[
          { id: 'name', header: 'Nome', sortable: true, hideable: false },
          {
            id: 'email_address',
            header: 'E-mail',
            cell: (b) => <span className="font-mono">{b.email_address}</span>,
            sortable: true,
          },
          {
            id: 'status',
            header: 'Status',
            cell: (b) => (
              <span title={b.last_error ?? undefined}>
                <MailboxStatusBadge status={b.status} />
              </span>
            ),
          },
          {
            id: 'last_synced_at',
            header: 'Última sincronização',
            cell: (b) =>
              b.last_synced_at
                ? formatDistanceToNow(new Date(b.last_synced_at), { addSuffix: true, locale: ptBR })
                : 'Ainda não sincronizada',
          },
        ]}
        data={q.data ?? []}
        query={query}
        onQueryChange={(search) => void navigate({ to: '/settings/mailboxes', search })}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowActions={(b) => (
          <>
            <Button asChild size="icon" variant="ghost">
              <Link
                to="/settings/mailboxes/$mailboxId"
                params={{ mailboxId: b.id }}
                aria-label={'Configurar ' + b.name}
              >
                <Settings />
              </Link>
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="icon" aria-label={'Reconectar ' + b.name}>
                  <RefreshCw />
                </Button>
              }
              title="Reconectar caixa?"
              description="A conexão será verificada com os dados atuais."
              onConfirm={() => action(b.id, 'reconnect')}
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  {b.status === 'disabled' ? 'Reativar' : 'Desativar'}
                </Button>
              }
              title={b.status === 'disabled' ? 'Reativar caixa?' : 'Desativar caixa?'}
              description={
                b.status === 'disabled'
                  ? 'A conexão será verificada novamente.'
                  : 'A sincronização e os novos envios serão suspensos.'
              }
              onConfirm={() => action(b.id, b.status === 'disabled' ? 'enable' : 'disable')}
            />
          </>
        )}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conectar caixa de e-mail</DialogTitle>
            <DialogDescription>
              Informe a conta, o servidor e os acessos da equipe.
            </DialogDescription>
          </DialogHeader>
          {open && <MailboxWizard onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
