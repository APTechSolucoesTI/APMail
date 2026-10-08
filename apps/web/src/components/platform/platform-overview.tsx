import { tableParameters } from '@/lib/table-query';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  PlatformOverview,
  MeteringResult,
  ListQuery,
  ListResult,
  MeteredRow,
} from '@apmail/shared';
import { hostMetricsSchema } from '@apmail/shared';
import { api } from '@/lib/api';
import { formatStorageBytes, storagePercentage, integrityLabels } from '@/lib/storage-metering';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { StorageHistory } from './storage-history';
import { StorageComposition } from './storage-composition';

const object = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
function Metric({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {help && <p className="mt-2 text-xs text-muted-foreground">{help}</p>}
    </article>
  );
}
export function PlatformOverviewDashboard({
  period,
  onManage,
  onStorage,
  onSelectTenant,
}: {
  period: string;
  onManage: () => void;
  onStorage: () => void;
  onSelectTenant: (tenantId: string) => void;
}) {
  const [rankQueries, setRankQueries] = useState<Record<string, ListQuery>>({
    tenant: { page: 1, pageSize: 10, filters: {} },
    mailbox: { page: 1, pageSize: 10, filters: {} },
    growth: { page: 1, pageSize: 10, filters: {} },
    boxGrowth: { page: 1, pageSize: 10, filters: {} },
    queues: { page: 1, pageSize: 10, filters: {} },
    activity: { page: 1, pageSize: 10, filters: {} },
  });
  const overview = useQuery({
    queryKey: ['platform', 'overview', period],
    queryFn: ({ signal }) =>
      api<PlatformOverview>('/superadmin/dashboard?period=' + period, { signal }),
    refetchInterval: 30000,
  });
  const boxes = useQuery({
    queryKey: ['platform', 'ranking-boxes'],
    queryFn: ({ signal }) =>
      api<MeteringResult>('/superadmin/metering?scope=mailboxes&pageSize=10', { signal }),
    refetchInterval: 60000,
  });
  const extras = useQuery({
    queryKey: ['platform', 'shared-metering'],
    queryFn: async ({ signal }) =>
      Promise.all(
        ['platform', 'unassigned'].map((scope) =>
          api<MeteringResult>('/superadmin/metering?scope=' + scope, { signal }),
        ),
      ),
    refetchInterval: 60000,
  });
  const growth = useQuery({
    queryKey: ['platform', 'growth', period],
    queryFn: ({ signal }) =>
      api<
        {
          id: string;
          name: string;
          growth_bytes: string;
          baseline_at: string;
          measured_at: string;
          samples: number;
        }[]
      >('/superadmin/metering/growth?period=' + period, { signal }),
    refetchInterval: 60000,
  });
  const boxGrowth = useQuery({
    queryKey: ['platform', 'growth-boxes', period],
    queryFn: ({ signal }) =>
      api<
        {
          id: string;
          name: string;
          growth_bytes: string;
          baseline_at: string;
          measured_at: string;
          samples: number;
        }[]
      >('/superadmin/metering/growth?scope=mailboxes&period=' + period, { signal }),
    refetchInterval: 60000,
  });
  if (overview.isLoading) return <LoadingState />;
  if (overview.error) return <ErrorState onRetry={() => void overview.refetch()} />;
  const data = overview.data!;
  const sample = data.resources.find((s) => s.source === 'infrastructure'),
    m = sample?.metrics ?? {},
    disk = object(m.disk),
    database = object(m.database),
    redis = object(m.redis),
    worker = object(m.worker),
    backups = object(m.backups),
    logs = object(m.logs);
  const host = hostMetricsSchema.safeParse(
    data.resources.find((s) => s.source === 'host')?.metrics,
  );
  const percent = storagePercentage(text(disk.used_bytes), text(disk.total_bytes));
  const stale =
    !sample || overview.dataUpdatedAt - new Date(sample.measured_at).getTime() > 15 * 60000;
  const workerOk =
    !!data.worker_heartbeat &&
    overview.dataUpdatedAt - new Date(data.worker_heartbeat).getTime() <
      data.thresholds.heartbeat_seconds * 1000;
  const rankingColumns: ListColumn<MeteredRow>[] = [
    {
      id: 'name',
      header: 'Nome',
      hideable: false,
      cell: (v) => <span title={v.name}>{v.name}</span>,
    },
    {
      id: 'attributed_bytes',
      header: 'Dados atribuídos',
      align: 'right',
      cell: (v) => (
        <span title={BigInt(v.attributed_bytes).toLocaleString('pt-BR') + ' bytes'}>
          {formatStorageBytes(v.attributed_bytes)}
        </span>
      ),
    },
    {
      id: 'quality',
      header: 'Medição',
      cell: (v) => ({ pending: 'Pendente', partial: 'Parcial', verified: 'Verificada' })[v.quality],
    },
  ];
  return (
    <div className="space-y-6">
      <section aria-label="Visão geral" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Visão geral do sistema</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onManage}>
              Gerenciar empresas
            </Button>
            <Button onClick={onStorage}>Consultar armazenamento</Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Indicadores consolidados da plataforma. Falhas de envio e atividade consideram o período
          selecionado; cadastros representam a situação atual.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['Empresas ativas', data.counts.tenants],
              ['Empresas suspensas', data.counts.suspended],
              ['Caixas cadastradas', data.counts.mailboxes],
              ['Usuários únicos vinculados', data.counts.users],
              ['Superadmins', data.counts.platform_admins],
              ['Convites pendentes', data.counts.invitations],
              ['Convites com falha no período', data.counts.failed_invites],
              ['Mensagens registradas', data.counts.messages],
              ['Falhas de envio', data.counts.failed_sends],
              ['Caixas com erro', data.counts.mailbox_errors],
              ['Caixas pendentes', data.counts.mailbox_pending],
              ['Sincronizações atrasadas', data.counts.sync_delayed],
            ] as const
          ).map(([label, value]) => (
            <Metric key={label} label={label} value={value.toLocaleString('pt-BR')} />
          ))}
        </div>
      </section>
      <section className="space-y-3" aria-label="Consumo e capacidade">
        <h2 className="text-xl font-semibold">Consumo e capacidade</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Dados atribuídos às empresas"
            value={
              data.storage.measured_at
                ? formatStorageBytes(data.storage.summary.attributed_bytes)
                : 'Pendente'
            }
            help="Dados lógicos e arquivos presentes. Não é o tamanho físico do banco."
          />
          <Metric
            label="Arquivos das empresas"
            value={
              data.storage.measured_at
                ? formatStorageBytes(data.storage.summary.file_bytes)
                : 'Pendente'
            }
          />
          <Metric
            label="Banco físico compartilhado"
            value={formatStorageBytes(text(database.database_bytes))}
            help="PostgreSQL global; não somar novamente ao payload lógico."
          />
          <Metric
            label="Espaço livre no volume"
            value={formatStorageBytes(text(disk.free_bytes))}
            help={
              percent === null
                ? 'Fonte indisponível'
                : `${percent.toLocaleString('pt-BR')}% utilizado · ${formatStorageBytes(text(disk.total_bytes))} de capacidade`
            }
          />
        </div>
        {percent !== null && percent >= data.thresholds.disk_warning_percent && (
          <p role="status" className="rounded-md border bg-muted p-3 text-sm font-semibold">
            {percent >= data.thresholds.disk_critical_percent ? 'Crítico' : 'Atenção'}: o volume
            ultrapassou{' '}
            {percent >= data.thresholds.disk_critical_percent
              ? data.thresholds.disk_critical_percent
              : data.thresholds.disk_warning_percent}
            % de utilização.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {data.capacity_forecast
            ? `Estimativa de capacidade: aproximadamente ${data.capacity_forecast.days_remaining.toLocaleString('pt-BR')} dias ao ritmo observado de ${formatStorageBytes(data.capacity_forecast.daily_growth_bytes)}/dia no filesystem compartilhado. Outros projetos e backups também influenciam esse ritmo.`
            : 'Projeção de capacidade indisponível: requer pelo menos sete dias de medições físicas comparáveis, atuais e com crescimento positivo.'}
        </p>
        <p role="status" className="text-sm text-muted-foreground">
          Armazenamento:{' '}
          {data.storage.measured_at
            ? new Date(data.storage.measured_at).toLocaleString('pt-BR')
            : 'aguardando inventário'}{' '}
          · {data.storage.summary.discrepancies} divergências. Infraestrutura:{' '}
          {sample ? new Date(sample.measured_at).toLocaleString('pt-BR') : 'indisponível'}
          {stale ? ' · Coleta pendente ou desatualizada.' : ''}
        </p>
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Detalhar infraestrutura, plataforma e dados sem atribuição
          </summary>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['Tabelas PostgreSQL', text(database.table_bytes)],
                ['Índices PostgreSQL', text(database.index_bytes)],
                ['TOAST PostgreSQL', text(database.toast_bytes)],
                ['WAL compartilhado', text(database.wal_bytes)],
                ['Redis em memória', text(redis.memory_bytes)],
                ['Redis AOF persistente', text(redis.aof_bytes)],
                [
                  'Backups físicos',
                  text(backups.bytes) ??
                    (host.success
                      ? host.data.sources.find((v) => v.id === 'backups')?.apparent_bytes
                      : null),
                ],
                [
                  'Logs físicos',
                  text(logs.bytes) ??
                    (host.success
                      ? host.data.sources.find((v) => v.id === 'logs')?.apparent_bytes
                      : null),
                ],
                [
                  worker.source === 'cli' ? 'Processo de coleta RSS' : 'Worker RSS',
                  text(worker.rss_bytes),
                ],
                [
                  worker.source === 'cli'
                    ? 'Memória do contêiner de coleta'
                    : 'Memória do contêiner worker',
                  text(worker.container_memory_bytes),
                ],
                [
                  worker.source === 'cli'
                    ? 'Limite do contêiner de coleta'
                    : 'Limite do contêiner worker',
                  text(worker.container_memory_limit_bytes),
                ],
                ['Dados globais da plataforma', extras.data?.[0]?.summary.attributed_bytes ?? null],
                ['Arquivos sem atribuição', extras.data?.[1]?.summary.file_bytes ?? null],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm tabular-nums">{formatStorageBytes(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Bytes aparentes e blocos alocados são medidas diferentes. Hardlinks são contados uma
            vez; compressão e reflinks não permitem atribuir blocos exclusivos. Backups, logs e
            persistência Redis exigem fontes de coleta configuradas. Não há cotas ou bloqueios por
            consumo.
          </p>
        </details>
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Volumes e recursos dos serviços
          </summary>
          {host.success ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Coleta do host: {new Date(host.data.measured_at).toLocaleString('pt-BR')}
                {overview.dataUpdatedAt - new Date(host.data.measured_at).getTime() > 15 * 60000
                  ? ' · Desatualizada.'
                  : ''}{' '}
                Volumes com o mesmo identificador compartilham capacidade; não somar suas
                capacidades.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {host.data.sources.map((v) => (
                  <article key={v.id} className="rounded-md border p-3">
                    <h3 className="text-sm font-semibold">
                      {
                        {
                          storage: 'Arquivos da aplicação',
                          database: 'Volume do PostgreSQL',
                          redis: 'Persistência Redis',
                          backups: 'Backups',
                          logs: 'Logs físicos',
                          api: 'Serviço API',
                          worker: 'Serviço worker',
                          web: 'Serviço web',
                        }[v.id]
                      }
                    </h3>
                    <p className="mt-2 text-xs">
                      {v.quality === 'verified'
                        ? 'Verificado'
                        : v.quality === 'partial'
                          ? 'Parcial'
                          : 'Indisponível'}
                    </p>
                    {v.device && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Volume {v.device} · Livre: {formatStorageBytes(v.free_bytes)}
                      </p>
                    )}
                    <p className="mt-1 text-xs">Arquivos: {formatStorageBytes(v.apparent_bytes)}</p>
                    <p className="mt-1 text-xs">Alocado: {formatStorageBytes(v.allocated_bytes)}</p>
                    {['api', 'worker', 'web'].includes(v.id) && (
                      <>
                        <p className="mt-1 text-xs">
                          Memória: {formatStorageBytes(v.memory_bytes)}
                        </p>
                        <p className="mt-1 text-xs">
                          CPU:{' '}
                          {v.cpu_percent === null
                            ? 'Indisponível'
                            : v.cpu_percent.toLocaleString('pt-BR') + '% de um núcleo'}
                        </p>
                      </>
                    )}
                  </article>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Backup:{' '}
                {host.data.backup?.completed_at
                  ? new Date(host.data.backup.completed_at).toLocaleString('pt-BR')
                  : 'Conclusão indisponível'}{' '}
                · Checksum:{' '}
                {host.data.backup?.checksum_verified ? 'Verificado' : 'Sem verificação registrada'}{' '}
                · Restauração ensaiada:{' '}
                {host.data.backup?.restored_at
                  ? new Date(host.data.backup.restored_at).toLocaleString('pt-BR')
                  : 'Não registrada'}
                .
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Coleta do host indisponível. Configure o coletor de metadados para visualizar volumes,
              backups, logs e recursos dos serviços.
            </p>
          )}
        </details>
      </section>
      <StorageHistory period={period} />
      <StorageComposition categories={data.storage.summary_categories ?? []} />
      <div className="grid gap-4 xl:grid-cols-2">
        {[
          ['Empresas com maior consumo', data.storage, 'tenant'],
          ['Caixas com maior consumo', boxes.data, 'mailbox'],
        ].map(([title, raw, key]) => {
          const result = raw as MeteringResult | undefined;
          return (
            <section key={String(key)} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-xl font-semibold">{String(title)}</h2>
              <ConfigurableTable
                listKey={'platform-ranking-' + key}
                mode="client"
                query={rankQueries[String(key)]!}
                onQueryChange={(next) =>
                  setRankQueries((previous) => ({ ...previous, [String(key)]: next }))
                }
                columns={rankingColumns}
                data={result?.items ?? []}
                isLoading={key === 'mailbox' ? boxes.isLoading : false}
                error={key === 'mailbox' ? boxes.error : undefined}
                onRetry={() => void boxes.refetch()}
                rowActions={(v) =>
                  v.tenant_id ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSelectTenant(v.tenant_id!)}
                    >
                      Empresa
                    </Button>
                  ) : null
                }
              />
            </section>
          );
        })}
      </div>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-xl font-semibold">Empresas com maior crescimento</h2>
        <p className="text-sm text-muted-foreground">
          Diferença entre a primeira e a última medição disponíveis no período. Sem duas medições,
          não há projeção.
        </p>
        <ConfigurableTable
          listKey="platform-ranking-growth"
          mode="client"
          query={rankQueries.growth!}
          onQueryChange={(next) => setRankQueries((previous) => ({ ...previous, growth: next }))}
          data={growth.data ?? []}
          emptyState={
            <p role="status" className="p-6 text-sm text-muted-foreground">
              Ainda não há duas medições comparáveis de uma empresa no período selecionado.
            </p>
          }
          isLoading={growth.isLoading}
          error={growth.error}
          onRetry={() => void growth.refetch()}
          columns={[
            { id: 'name', header: 'Empresa', hideable: false },
            {
              id: 'growth_bytes',
              header: 'Variação observada',
              align: 'right',
              cell: (v) => formatStorageBytes(v.growth_bytes),
            },
            {
              id: 'baseline_at',
              header: 'Medição inicial',
              cell: (v) => new Date(v.baseline_at).toLocaleString('pt-BR'),
            },
            {
              id: 'measured_at',
              header: 'Medição final',
              cell: (v) => new Date(v.measured_at).toLocaleString('pt-BR'),
            },
          ]}
        />
      </section>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-xl font-semibold">Caixas com maior crescimento</h2>
        <ConfigurableTable
          listKey="platform-ranking-box-growth"
          mode="client"
          query={rankQueries.boxGrowth!}
          onQueryChange={(next) => setRankQueries((previous) => ({ ...previous, boxGrowth: next }))}
          data={boxGrowth.data ?? []}
          isLoading={boxGrowth.isLoading}
          error={boxGrowth.error}
          onRetry={() => void boxGrowth.refetch()}
          emptyState={
            <p role="status" className="p-6 text-sm text-muted-foreground">
              Ainda não há duas medições verificadas de uma caixa no período selecionado.
            </p>
          }
          columns={[
            { id: 'name', header: 'Caixa', hideable: false },
            {
              id: 'growth_bytes',
              header: 'Variação observada',
              align: 'right',
              cell: (v) => formatStorageBytes(v.growth_bytes),
            },
            {
              id: 'baseline_at',
              header: 'Medição inicial',
              cell: (v) => new Date(v.baseline_at).toLocaleString('pt-BR'),
            },
            {
              id: 'measured_at',
              header: 'Medição final',
              cell: (v) => new Date(v.measured_at).toLocaleString('pt-BR'),
            },
          ]}
        />
      </section>
      <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Saúde operacional">
        <h2 className="text-xl font-semibold">Saúde operacional e filas</h2>
        <p className="text-sm">
          Banco: {data.services.database === 'ok' ? 'Operacional' : 'Falha'} · Redis:{' '}
          {data.services.redis === 'ok' ? 'Operacional' : 'Falha'} · Worker:{' '}
          {workerOk ? 'Ativo' : 'Sem sinal recente'}
        </p>
        <p className="text-sm text-muted-foreground">
          {data.counts.mailbox_errors} caixas com erro · {data.counts.mailbox_pending} caixas
          pendentes · {data.counts.sync_delayed} sincronizações atrasadas.
        </p>
        <ConfigurableTable
          listKey="platform-operational-queues"
          mode="client"
          query={rankQueries.queues!}
          onQueryChange={(query) => setRankQueries((current) => ({ ...current, queues: query }))}
          data={data.queues.map((value) => ({ ...value, id: value.name }))}
          columns={[
            { id: 'name', header: 'Fila', hideable: false },
            {
              id: 'waiting',
              header: 'Em espera',
              align: 'right',
              cell: (value) => value.waiting ?? 'Indisponível',
            },
            {
              id: 'active',
              header: 'Em execução',
              align: 'right',
              cell: (value) => value.active ?? 'Indisponível',
            },
            {
              id: 'delayed',
              header: 'Agendadas',
              align: 'right',
              cell: (value) => value.delayed ?? 'Indisponível',
            },
            {
              id: 'failed',
              header: 'Falhas',
              align: 'right',
              cell: (value) => value.failed ?? 'Indisponível',
            },
            {
              id: 'oldest_waiting_at',
              header: 'Espera mais antiga',
              cell: (value) =>
                value.oldest_waiting_at
                  ? new Date(value.oldest_waiting_at).toLocaleString('pt-BR')
                  : 'Sem tarefa em espera',
            },
          ]}
        />
      </section>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-xl font-semibold">Atividade recente de gestão</h2>
        <ConfigurableTable
          listKey="platform-recent-activity"
          mode="client"
          query={rankQueries.activity!}
          onQueryChange={(query) => setRankQueries((current) => ({ ...current, activity: query }))}
          data={data.audit}
          columns={[
            { id: 'action', header: 'Ação', hideable: false },
            { id: 'tenant_name', header: 'Empresa' },
            {
              id: 'created_at',
              header: 'Data e hora',
              cell: (value) => new Date(value.created_at).toLocaleString('pt-BR'),
            },
          ]}
        />
      </section>
    </div>
  );
}
type IntegrityRow = {
  id: string;
  code: string;
  tenant_name: string | null;
  mailbox_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
};
export function PlatformIntegrity({
  query,
  tenantId,
  onChange,
}: {
  query: ListQuery;
  tenantId?: string;
  onChange: (q: ListQuery) => void;
}) {
  const [runsQuery, setRunsQuery] = useState<ListQuery>({ page: 1, pageSize: 10, filters: {} });
  const q = useQuery({
    queryKey: ['platform', 'integrity', tenantId, query],
    queryFn: ({ signal }) =>
      api<ListResult<IntegrityRow>>(
        '/superadmin/metering/integrity?' +
          new URLSearchParams({
            ...tableParameters(query),
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
            ...(tenantId ? { tenant_id: tenantId } : {}),
          }),
        { signal },
      ),
    refetchInterval: 30000,
  });
  const runs = useQuery({
    queryKey: ['platform', 'metering-runs'],
    queryFn: ({ signal }) =>
      api<
        {
          id: string;
          mode: string;
          state: string;
          checked_files: string;
          error_count: string;
          created_at: string;
        }[]
      >('/superadmin/metering/runs', { signal }),
    refetchInterval: 30000,
  });
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Integridade do armazenamento</h2>
      <p className="text-sm text-muted-foreground">
        Divergências são verificadas pelo worker. Esta tela exibe metadados de gestão; não oferece
        abertura ou exclusão de arquivos.
      </p>
      <ConfigurableTable
        listKey="platform-storage-integrity"
        mode="server"
        query={query}
        onQueryChange={onChange}
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        searchPlaceholder="Buscar código da divergência ou empresa…"
        columns={[
          {
            id: 'code',
            header: 'Divergência',
            hideable: false,
            cell: (v) => integrityLabels[v.code] ?? v.code,
          },
          { id: 'tenant_name', header: 'Empresa' },
          { id: 'mailbox_name', header: 'Caixa' },
          {
            id: 'first_seen_at',
            header: 'Primeira ocorrência',
            cell: (v) => new Date(v.first_seen_at).toLocaleString('pt-BR'),
          },
          {
            id: 'last_seen_at',
            header: 'Última verificação',
            cell: (v) => new Date(v.last_seen_at).toLocaleString('pt-BR'),
          },
        ]}
      />
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Últimas reconciliações</summary>
        {runs.error ? (
          <ErrorState onRetry={() => void runs.refetch()} />
        ) : runs.isLoading ? (
          <LoadingState />
        ) : (
          <ConfigurableTable
            listKey="platform-scan-runs"
            mode="client"
            query={runsQuery}
            onQueryChange={setRunsQuery}
            data={runs.data ?? []}
            columns={[
              {
                id: 'created_at',
                header: 'Data e hora',
                hideable: false,
                cell: (r) => new Date(r.created_at).toLocaleString('pt-BR'),
              },
              { id: 'mode', header: 'Modo' },
              { id: 'state', header: 'Estado' },
              { id: 'checked_files', header: 'Arquivos', align: 'right' },
              { id: 'error_count', header: 'Erros', align: 'right' },
            ]}
          />
        )}
      </details>
    </section>
  );
}
