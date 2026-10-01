import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { z } from 'zod';
import { Pencil, Trash2, Send, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { listQuerySchema, type ListResult } from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery, useTenantId, type Mailbox } from '@/lib/auth';
import type { Outbox } from '@/lib/outbox';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { OutboxStatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { useSocketRoom } from '@/hooks/use-socket-room';
function OutboxRoom({ id }: { id: string }) {
  useSocketRoom('mailbox', id);
  return null;
}
const schema = listQuerySchema.extend({
  tab: z.enum(['drafts', 'scheduled', 'queued', 'failed']).default('scheduled'),
  mailboxId: z.uuid().optional(),
});
export const Route = createFileRoute('/_app/scheduled')({
  validateSearch: schema,
  component: Scheduled,
});
function Scheduled() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery);
  const boxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const params = new URLSearchParams({
    tab: search.tab,
    page: String(search.page),
    page_size: String(search.pageSize),
  });
  if (search.mailboxId) params.set('mailbox_id', search.mailboxId);
  if (search.search) params.set('search', search.search);
  const q = useQuery({
    queryKey: ['outbox', tenant, params.toString()],
    queryFn: () => api<ListResult<Outbox>>('/outbox?' + params),
    placeholderData: keepPreviousData,
    refetchInterval: search.tab === 'queued' ? 10000 : false,
  });
  const action = async (row: Outbox, type: string) => {
    await api('/outbox/' + row.id + '/' + type, { method: 'POST' });
    await client.invalidateQueries({ queryKey: ['outbox', tenant] });
    toast.success(type === 'retry' ? 'Envio recolocado na fila.' : 'Envio atualizado.');
  };
  const creator = (o: Outbox) =>
    typeof o.created_by === 'string' ? o.created_by : o.created_by.id;
  const resume = async (o: Outbox) => {
    if (o.status !== 'draft') await api('/outbox/' + o.id + '/cancel', { method: 'POST' });
    await navigate({
      to: '/mail/$mailboxId',
      params: { mailboxId: o.mailbox_id },
      search: { compose: 'draft:' + o.id, thread: o.thread_id ?? undefined },
    });
  };
  return (
    <>
      {boxes.data?.map((b) => (
        <OutboxRoom key={b.id} id={b.id} />
      ))}
      <PageHeader
        title="Envios"
        description="Acompanhe seus rascunhos e os envios das caixas compartilhadas."
      />
      <Tabs
        value={search.tab}
        onValueChange={(tab) =>
          void navigate({ search: { ...search, tab: tab as typeof search.tab, page: 1 } })
        }
      >
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="drafts">Rascunhos</TabsTrigger>
          <TabsTrigger value="scheduled">Agendados</TabsTrigger>
          <TabsTrigger value="queued">Na fila</TabsTrigger>
          <TabsTrigger value="failed">Com falha</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mb-4 max-w-sm space-y-1">
        <Label htmlFor="outbox-mailbox">Caixa</Label>
        <select
          id="outbox-mailbox"
          className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
          value={search.mailboxId ?? ''}
          onChange={(e) =>
            void navigate({
              search: { ...search, mailboxId: e.target.value || undefined, page: 1 },
            })
          }
        >
          <option value="">Todas as caixas</option>
          {boxes.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <ConfigurableTable
        listKey={'outbox-' + search.tab}
        mode="server"
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        query={search}
        onQueryChange={(query) => void navigate({ search: { ...search, ...query } })}
        isLoading={q.isLoading}
        isFetching={q.isFetching && !q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          {
            id: 'updated_at',
            header: search.tab === 'scheduled' ? 'Agendado para' : 'Atualizado em',
            cell: (o) =>
              new Date(
                (search.tab === 'scheduled' ? o.scheduled_at : null) ?? o.updated_at,
              ).toLocaleString('pt-BR', {
                timeZone: me.data?.preferences.timezone,
                timeZoneName: 'short',
              }),
          },
          { id: 'mailbox', header: 'Caixa', cell: (o) => o.mailbox?.name ?? '' },
          {
            id: 'subject',
            header: 'Assunto',
            hideable: false,
            cell: (o) => <span title={o.subject}>{o.subject || '(Sem assunto)'}</span>,
          },
          {
            id: 'to_addresses',
            header: 'Para',
            cell: (o) => (
              <span title={o.to_addresses.map((a) => a.address).join(', ')}>
                {o.to_addresses.map((a) => a.address).join(', ') || 'Sem destinatário'}
              </span>
            ),
          },
          {
            id: 'created_by',
            header: 'Criado por',
            cell: (o) => (typeof o.created_by === 'string' ? '' : o.created_by.full_name),
          },
          {
            id: 'kind',
            header: 'Tipo',
            cell: (o) =>
              ({
                new: 'Novo',
                reply: 'Resposta',
                reply_all: 'Resposta a todos',
                forward: 'Encaminhamento',
              })[o.kind],
          },
          {
            id: 'status',
            header: 'Status',
            cell: (o) => (
              <div>
                <OutboxStatusBadge status={o.status} />
                {o.last_error && <p className="mt-1 text-xs text-destructive">{o.last_error}</p>}
              </div>
            ),
          },
        ]}
        rowActions={(o) => (
          <>
            {o.can_edit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={'Editar ' + (o.subject || 'rascunho')}
                onClick={() => void resume(o).catch((e) => toast.error(e.message))}
              >
                <Pencil />
              </Button>
            )}
            {o.status === 'scheduled' && creator(o) === me.data?.user.id && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={'Enviar agora ' + o.subject}>
                    <Send />
                  </Button>
                }
                title="Enviar agora?"
                description="O envio será colocado imediatamente na fila."
                onConfirm={() => action(o, 'send-now')}
              />
            )}
            {o.status === 'failed' && creator(o) === me.data?.user.id && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={'Tentar novamente ' + o.subject}>
                    <RefreshCw />
                  </Button>
                }
                title="Tentar enviar novamente?"
                description="O envio voltará à fila."
                onConfirm={() => action(o, 'retry')}
              />
            )}
            {(o.can_cancel || o.status === 'draft') && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      (o.status === 'draft' ? 'Excluir rascunho ' : 'Cancelar ') + o.subject
                    }
                  >
                    <Trash2 />
                  </Button>
                }
                title={o.status === 'draft' ? 'Excluir rascunho?' : 'Cancelar envio?'}
                description={
                  o.status === 'draft'
                    ? 'O texto e os anexos deste rascunho serão removidos.'
                    : 'A mensagem será retirada da fila antes do envio.'
                }
                onConfirm={async () => {
                  if (o.status === 'draft') await api('/outbox/' + o.id, { method: 'DELETE' });
                  else await api('/outbox/' + o.id + '/cancel', { method: 'POST' });
                  await q.refetch();
                }}
              />
            )}
          </>
        )}
      />
    </>
  );
}
