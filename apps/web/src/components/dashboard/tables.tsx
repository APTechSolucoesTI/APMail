import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import type { StaleThread, UserProductivity, ListQuery } from '@apmail/shared';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { EmptyState } from '@/components/data/data-state';
import { UserAvatar } from '@/components/common/user-avatar';
import { QueueStatusBadge, OverdueBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { durationLabel, productivityCsv } from '@/lib/dashboard';
type BlockData<T> = {
  data?: T[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
};
const initial: ListQuery = { page: 1, pageSize: 10, filters: {} };
const empty = (
  <EmptyState title="Sem dados no período" description="Ajuste o período ou escolha outra caixa." />
);
export function UserTable({
  from,
  to,
  ...props
}: BlockData<UserProductivity> & { from: string; to: string }) {
  const [query, setQuery] = useState(initial);
  const download = () => {
    const href = URL.createObjectURL(
      new Blob([productivityCsv(props.data ?? [])], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = href;
    link.download = `apmail-produtividade-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(href);
  };
  return (
    <ConfigurableTable
      listKey="dashboard-users"
      mode="client"
      data={(props.data ?? []).map((row) => ({ ...row, id: row.user_id }))}
      query={query}
      onQueryChange={setQuery}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      error={props.error}
      onRetry={props.onRetry}
      emptyState={empty}
      toolbarLeft={
        <Button
          variant="outline"
          onClick={download}
          disabled={!props.data?.length || props.isFetching}
          aria-label="Exportar CSV de todos os usuários deste período e caixa"
        >
          <Download className="size-4" aria-hidden />
          Exportar CSV
        </Button>
      }
      columns={[
        {
          id: 'full_name',
          header: 'Usuário',
          hideable: false,
          sortable: true,
          cell: (row) => (
            <span className="flex items-center gap-2">
              <span aria-hidden>
                <UserAvatar name={row.full_name} src={row.avatar_url} size={24} />
              </span>
              {row.full_name}
            </span>
          ),
        },
        { id: 'sent', header: 'Enviados', align: 'right', sortable: true },
        { id: 'threads_replied', header: 'Conversas respondidas', align: 'right', sortable: true },
        {
          id: 'avg_reply_minutes',
          header: 'Tempo médio de resposta',
          align: 'right',
          sortable: true,
          cell: (row) => durationLabel(row.avg_reply_minutes),
        },
        { id: 'open_assigned', header: 'Atribuídas em aberto', align: 'right', sortable: true },
        { id: 'done_in_period', header: 'Concluídas no período', align: 'right', sortable: true },
      ]}
    />
  );
}
export function StaleThreadsTable(props: BlockData<StaleThread>) {
  const [query, setQuery] = useState(initial);
  return (
    <ConfigurableTable
      listKey="dashboard-stale"
      mode="client"
      data={(props.data ?? []).map((row) => ({ ...row, id: row.thread_id }))}
      query={query}
      onQueryChange={setQuery}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      error={props.error}
      onRetry={props.onRetry}
      emptyState={
        <EmptyState
          title="Sem conversas em aberto"
          description="Nenhuma conversa está aguardando atendimento nas caixas escolhidas."
        />
      }
      columns={[
        {
          id: 'subject',
          header: 'Assunto',
          hideable: false,
          sortable: true,
          cell: (row) => (
            <Link
              className="break-words text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              to="/mail/$mailboxId"
              params={{ mailboxId: row.mailbox_id }}
              search={{ view: 'queue', queue: row.queue_status, thread: row.thread_id }}
            >
              {row.subject || '(Sem assunto)'}
            </Link>
          ),
        },
        { id: 'mailbox_name', header: 'Caixa', sortable: true },
        {
          id: 'queue_status',
          header: 'Status',
          cell: (row) => <QueueStatusBadge status={row.queue_status} />,
        },
        {
          id: 'assigned_name',
          header: 'Responsável',
          sortable: true,
          cell: (row) => row.assigned_name ?? 'Não atribuído',
        },
        {
          id: 'waiting_minutes',
          header: 'Aguardando há',
          sortable: true,
          align: 'right',
          cell: (row) => (
            <span className="inline-flex flex-col items-end gap-1">
              <span className="tabular-nums">{durationLabel(row.waiting_minutes)}</span>
              {row.is_overdue && <OverdueBadge />}
            </span>
          ),
        },
      ]}
    />
  );
}
