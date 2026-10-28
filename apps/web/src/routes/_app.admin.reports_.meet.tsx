import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { RefreshCw, Settings, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  meetReportQuerySchema,
  type MeetReportResult,
  type MeetReportRow,
  type MeetReportQuery,
  type ListQuery,
} from '@apmail/shared';
import { toast } from 'sonner';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import { meetDate, meetDuration, meetStatusLabels } from '@/lib/meet-reports';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReportExport } from '@/components/integrations/report-export';
import { compactSelect } from '@/components/integrations/meet-preferences';
export const Route = createFileRoute('/_app/admin/reports_/meet')({
  validateSearch: meetReportQuerySchema,
  component: MeetReports,
});
function MeetReports() {
  const search = Route.useSearch(),
    navigate = useNavigate(),
    tenant = useTenantId(),
    me = useQuery(meQuery),
    [syncing, setSyncing] = useState(false);
  const query = { ...search, timezone: me.data?.preferences.timezone ?? search.timezone },
    params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const result = useQuery({
    queryKey: ['meet-reports', tenant, 'list', query],
    queryFn: ({ signal }) => api<MeetReportResult>('/reports/meet?' + params, { signal }),
    placeholderData: keepPreviousData,
  });
  const change = (values: Partial<MeetReportQuery>) =>
    void navigate({
      to: '/admin/reports/meet',
      search: { ...search, ...values, page: values.page ?? 1 },
    });
  const summary = result.data?.summary;
  const columns: ListColumn<MeetReportRow>[] = [
    {
      id: 'title',
      header: 'Reunião',
      cell: (row) => (
        <div className="min-w-48">
          <Link
            className="font-medium text-primary hover:underline"
            to="/admin/reports/meet/$meetingId"
            params={{ meetingId: row.id }}
          >
            {row.title}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.organizer ?? 'Organizador não informado'}
          </p>
        </div>
      ),
    },
    {
      id: 'date',
      header: 'Data',
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">
          {meetDate(row.date, query.timezone)}
          <span className="block text-xs text-muted-foreground">
            {row.actual_start ? 'Horário real' : 'Agendamento'}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Situação',
      sortable: false,
      cell: (row) => (
        <span
          className={
            'inline-flex rounded border px-1.5 py-0.5 text-xs ' +
            (row.status === 'completed'
              ? 'bg-success-bg text-success-fg'
              : row.status === 'ongoing'
                ? 'bg-secondary text-primary'
                : 'bg-muted text-muted-foreground')
          }
        >
          {meetStatusLabels[row.status]}
        </span>
      ),
    },
    {
      id: 'duration',
      header: 'Duração real',
      align: 'right',
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">{meetDuration(row.duration_seconds)}</span>
      ),
    },
    {
      id: 'participants',
      header: 'Participações',
      sortable: false,
      align: 'right',
      cell: (row) => row.participant_count ?? '—',
    },
    {
      id: 'files',
      header: 'Arquivos',
      sortable: false,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.recordings === null && row.transcripts === null && row.smart_notes === null
            ? 'Não consultados'
            : `${row.recordings ?? '—'} gravações · ${row.transcripts ?? '—'} transcrições · ${row.smart_notes ?? '—'} notas`}
        </span>
      ),
    },
    {
      id: 'account',
      header: 'Conta Google',
      sortable: false,
      defaultVisible: false,
      cell: (row) => row.account_email ?? 'Não associada',
    },
  ];
  const tableQuery: ListQuery = {
    page: search.page,
    pageSize: search.pageSize,
    search: search.search,
    filters: {},
    sort: search.sort.startsWith('title_')
      ? { key: 'title', direction: search.sort === 'title_asc' ? 'asc' : 'desc' }
      : search.sort.startsWith('duration_')
        ? { key: 'duration', direction: search.sort === 'duration_asc' ? 'asc' : 'desc' }
        : { key: 'date', direction: search.sort === 'date_asc' ? 'asc' : 'desc' },
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Google Meet"
        description="Agendamentos e conferências reais, com os dados disponibilizados pelo Google."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" asChild>
              <Link to="/admin/integrations">
                <Settings />
                Integração
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  const data = await api<{ queued: number }>('/integrations/google/sync', {
                    method: 'POST',
                    body: {},
                  });
                  toast.success(`${data.queued} salas adicionadas à fila de sincronização.`);
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setSyncing(false);
                }
              }}
            >
              <RefreshCw className={syncing ? 'animate-spin' : ''} />
              Sincronizar
            </Button>
            <ReportExport path={'/reports/meet/export?' + params} />
          </div>
        }
      />
      <section
        aria-label="Filtros de reuniões"
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
      >
        <label className="min-w-36 flex-1 space-y-1 text-xs font-medium">
          De
          <Input
            type="date"
            value={search.from}
            max={search.to}
            onChange={(e) => e.target.value && change({ from: e.target.value })}
          />
        </label>
        <label className="min-w-36 flex-1 space-y-1 text-xs font-medium">
          Até
          <Input
            type="date"
            value={search.to}
            min={search.from}
            onChange={(e) => e.target.value && change({ to: e.target.value })}
          />
        </label>
        <label className="min-w-40 flex-1 space-y-1 text-xs font-medium">
          Situação
          <select
            className={compactSelect}
            aria-label="Situação"
            value={search.status}
            onChange={(e) => change({ status: e.target.value as MeetReportQuery['status'] })}
          >
            <option value="all">Todas</option>
            {Object.entries(meetStatusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 space-y-1 text-xs font-medium">
          Conta Google
          <select
            className={compactSelect}
            aria-label="Conta Google"
            value={search.account}
            onChange={(e) => change({ account: e.target.value })}
          >
            <option value="">Todas</option>
            {result.data?.accounts.map((account) => (
              <option key={account}>{account}</option>
            ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 space-y-1 text-xs font-medium">
          Organizador
          <select
            className={compactSelect}
            aria-label="Organizador"
            value={search.organizer}
            onChange={(e) => change({ organizer: e.target.value })}
          >
            <option value="">Todos</option>
            {result.data?.organizers.map((organizer) => (
              <option key={organizer}>{organizer}</option>
            ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 space-y-1 text-xs font-medium">
          Arquivos
          <select
            className={compactSelect}
            aria-label="Arquivos"
            value={search.artifact}
            onChange={(e) => change({ artifact: e.target.value as MeetReportQuery['artifact'] })}
          >
            <option value="all">Todos</option>
            <option value="recording">Com gravação</option>
            <option value="transcript">Com transcrição</option>
            <option value="smart_notes">Com notas</option>
          </select>
        </label>
      </section>
      <section
        aria-label="Indicadores das reuniões"
        className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card sm:grid-cols-3 xl:grid-cols-6"
      >
        {[
          ['Concluídas', summary?.completed],
          ['Agendadas', summary?.scheduled],
          ['Tempo total real', summary ? meetDuration(summary.total_seconds) : undefined],
          ['Duração média', summary ? meetDuration(summary.average_seconds) : undefined],
          [
            'Participações importadas',
            result.data?.coverage.participants ? summary?.participations : undefined,
          ],
          ['Em andamento', summary?.ongoing],
        ].map(([label, value]) => (
          <div key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value ?? '—'}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.45fr)]">
        <section className="min-w-0 rounded-lg border bg-card p-3">
          <h2 className="mb-3 text-xs font-semibold">Reuniões por dia</h2>
          {result.data?.chart.length ? (
            <div
              className="h-40 w-full"
              role="img"
              aria-label="Comparação diária de reuniões concluídas e agendadas"
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                initialDimension={{ width: 640, height: 160 }}
              >
                <BarChart data={result.data.chart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => v.slice(5).split('-').reverse().join('/')}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      color: 'var(--popover-foreground)',
                      borderColor: 'var(--border)',
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    name="Concluídas"
                    dataKey="completed"
                    fill="var(--primary)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    name="Agendadas"
                    dataKey="scheduled"
                    fill="var(--muted-foreground)"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-xs text-muted-foreground">
              Sem dados para o gráfico neste período.
            </p>
          )}
        </section>
        <section className="space-y-3 rounded-lg border bg-card p-3">
          <h2 className="text-xs font-semibold">Arquivos e cobertura</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-2 text-xs">
            <dt>Reuniões com gravação</dt>
            <dd>{result.data?.coverage.recordings ? summary?.recordings : '—'}</dd>
            <dt>Com transcrição</dt>
            <dd>{result.data?.coverage.transcripts ? summary?.transcripts : '—'}</dd>
            <dt>Com notas inteligentes</dt>
            <dd>{result.data?.coverage.smart_notes ? summary?.smart_notes : '—'}</dd>
            <dt>Sem registro de realização</dt>
            <dd>{summary?.unverified ?? '—'}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            {result.data &&
              `Participantes consultados em ${result.data.coverage.participants} de ${result.data.coverage.records} conferências. `}
            Contagens refletem somente dados importados. Ausência de confirmação ou arquivo não
            comprova que a reunião não aconteceu ou não foi gravada.
          </p>
          <div className="flex flex-wrap gap-2">
            <ReportExport label="Duração" path={'/reports/meet/export?report=duration&' + params} />
            <ReportExport
              label="Arquivos"
              path={'/reports/meet/export?report=artifacts&' + params}
            />
          </div>
        </section>
      </div>
      {result.error && (
        <p role="alert" className="text-sm text-destructive">
          {result.error.message}
        </p>
      )}
      <ConfigurableTable
        listKey="meet-history"
        mode="server"
        columns={columns.map((column) => ({ ...column, filterable: false }))}
        data={result.data?.items ?? []}
        total={result.data?.total ?? 0}
        query={tableQuery}
        onQueryChange={(next) =>
          change({
            page: next.page,
            pageSize: next.pageSize,
            search: next.search ?? '',
            sort:
              next.sort?.key === 'title'
                ? next.sort.direction === 'desc'
                  ? 'title_desc'
                  : 'title_asc'
                : next.sort?.key === 'duration'
                  ? next.sort.direction === 'asc'
                    ? 'duration_asc'
                    : 'duration_desc'
                  : next.sort?.direction === 'asc'
                    ? 'date_asc'
                    : 'date_desc',
          })
        }
        isLoading={result.isPending}
        isFetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        searchPlaceholder="Buscar reunião, organizador ou conta…"
        rowActions={(row) => (
          <Button size="icon" variant="ghost" asChild>
            <Link
              to="/admin/reports/meet/$meetingId"
              params={{ meetingId: row.id }}
              aria-label={'Visualizar ' + row.title}
            >
              <Eye />
            </Link>
          </Button>
        )}
      />
    </div>
  );
}
