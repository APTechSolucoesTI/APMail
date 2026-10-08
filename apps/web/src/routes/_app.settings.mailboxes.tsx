import { useTenantId } from '@/lib/auth';
import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listQuerySchema, type TenantQuota } from '@apmail/shared';
import { MailboxStorageCell } from '@/components/storage/storage-quotas';
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
  const tenantId = useTenantId();
  const q = useQuery({
    queryKey: ['mailboxes', tenantId],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const storage = useQuery({
    queryKey: ['storage-quota', 'tenant', tenantId],
    queryFn: ({ signal }) => api<TenantQuota>('/tenant/storage', { signal }),
    refetchInterval: 60000,
  });
  const action = async (id: string, name: string) => {
    await api('/mailboxes/' + id + '/' + name, { method: 'POST' });
    await client.invalidateQueries();
  };
  return (
    <>
      <PageHeader
        title="Caixas de e-mail"
        description="Conecte IMAP/POP3 e SMTP ou crie caixas locais para importar backups."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            Conectar caixa
          </Button>
        }
      />
      {storage.error && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          Não foi possível atualizar o consumo das caixas.
          <Button
            variant="outline"
            size="sm"
            onClick={() => void storage.refetch()}
            disabled={storage.isFetching}
          >
            Tentar novamente
          </Button>
        </p>
      )}
      <ConfigurableTable
        listKey="mailboxes"
        mode="client"
        columns={[
          { id: 'name', header: 'Nome', sortable: true, hideable: false },
          {
            id: 'receiving_protocol',
            header: 'Tipo',
            cell: (b) =>
              b.receiving_protocol === 'pop3'
                ? 'POP3'
                : b.receiving_protocol === 'local'
                  ? 'Arquivo local'
                  : 'IMAP',
          },
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
            id: 'apmail_storage',
            stackOnMobile: true,
            header: 'Armazenamento APMail',
            hideable: false,
            cell: (b) => (
              <MailboxStorageCell
                quota={storage.data?.mailboxes.find((quota) => quota.mailbox_id === b.id)}
                error={!!storage.error}
              />
            ),
          },
          {
            id: 'provider_storage',
            stackOnMobile: true,
            header: 'Armazenamento no provedor',
            hideable: false,
            cell: (b) => (
              <MailboxStorageCell
                quota={storage.data?.mailboxes.find((quota) => quota.mailbox_id === b.id)}
                provider
                error={!!storage.error}
              />
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
