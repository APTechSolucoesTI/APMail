import { tableParameters } from '@/lib/table-query';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListQuery, MeteringResult, MeteredRow } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatStorageBytes, storageQuality, categoryLabels } from '@/lib/storage-metering';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { Button } from '@/components/ui/button';
import { StorageHistory } from './storage-history';
import { StorageComposition } from './storage-composition';
type Scope = 'tenants' | 'mailboxes';
export function PlatformStorage({
  query,
  scope,
  tenantId,
  lockTenant = false,
  period = '30d',
  onChange,
}: {
  query: ListQuery;
  scope: Scope;
  tenantId?: string;
  lockTenant?: boolean;
  period?: string;
  onChange: (query: ListQuery, scope: Scope, tenantId?: string) => void;
}) {
  const client = useQueryClient(),
    [categoryQuery, setCategoryQuery] = useState<ListQuery>({ page: 1, pageSize: 10, filters: {} }),
    [detail, setDetail] = useState<MeteredRow | null>(null),
    [exporting, setExporting] = useState(false);
  const params = new URLSearchParams({
    ...tableParameters(query),
    period,
    scope,
    page: String(query.page),
    pageSize: String(query.pageSize),
    search: query.search ?? '',
    ...(tenantId ? { tenant_id: tenantId } : {}),

    quality: query.filters.quality?.join(',') || 'all',
    retained: query.filters.retained?.length === 1 ? query.filters.retained[0]! : 'all',
  });
  const usage = useQuery({
    queryKey: ['platform', 'metering', scope, tenantId, query, period],
    queryFn: ({ signal }) => api<MeteringResult>('/superadmin/metering?' + params, { signal }),
    refetchInterval: 60000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === scope && previousQuery.queryKey[3] === tenantId
        ? previous
        : undefined,
  });
  const reconcile = useMutation({
    mutationFn: () =>
      api<{ already_running: boolean }>('/superadmin/metering/reconcile', {
        method: 'POST',
        body: { mode: 'full' },
      }),
    onSuccess: async (v) => {
      toast.success(
        v.already_running ? 'Reconciliação já em andamento.' : 'Reconciliação solicitada.',
      );
      await client.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: () => toast.error('Não foi possível solicitar a reconciliação.'),
  });
  const byteCell = (v: string | null) => (
    <span
      className="whitespace-nowrap tabular-nums"
      title={
        v === null
          ? 'Não disponível nesta infraestrutura'
          : `${BigInt(v).toLocaleString('pt-BR')} bytes`
      }
    >
      {formatStorageBytes(v)}
    </span>
  );
  const columns: ListColumn<MeteredRow>[] = [
    {
      id: 'name',
      header: scope === 'tenants' ? 'Empresa' : 'Caixa',
      hideable: false,
      sortable: true,
      cell: (v) => (
        <span title={v.name}>
          {v.name}
          {v.retained_deleted && (
            <span className="ml-2 text-muted-foreground">(excluída, dados retidos)</span>
          )}
        </span>
      ),
    },
    ...(scope === 'mailboxes'
      ? [
          { id: 'tenant_name', header: 'Empresa', sortable: true },
          { id: 'email_address', header: 'E-mail' },
        ]
      : []),
    ...(
      [
        'attributed_bytes',
        'file_bytes',
        'logical_bytes',
        'allocated_bytes',
        'retained_bytes',
      ] as const
    ).map((id) => ({
      id,
      header: {
        attributed_bytes: 'Dados atribuídos',
        file_bytes: 'Arquivos',
        logical_bytes: 'Dados lógicos',
        allocated_bytes: 'Disco alocado',
        retained_bytes: 'Dados retidos',
      }[id],
      align: 'right' as const,
      sortable: true,
      hideable: id !== 'attributed_bytes',
      cell: (r: MeteredRow) => byteCell(r[id]),
    })),
    {
      id: 'messages',
      header: 'Mensagens',
      align: 'right',
      sortable: true,
      cell: (v) => v.messages.toLocaleString('pt-BR'),
    },
    { id: 'discrepancies', header: 'Divergências', align: 'right', sortable: true },
    {
      id: 'growth_bytes',
      header: 'Crescimento no período',
      align: 'right',
      sortable: true,
      cell: (v) =>
        v.growth_bytes === null || v.growth_bytes === undefined
          ? 'Sem comparação'
          : byteCell(v.growth_bytes),
    },
    {
      id: 'status',
      header: 'Situação',
      cell: (v) =>
        (
          ({
            active: 'Ativa',
            disabled: 'Desativada',
            error: 'Erro',
            connecting: 'Conectando',
            suspended: 'Suspensa',
          }) as Record<string, string>
        )[v.status ?? ''] ?? v.status,
    },
    ...(scope === 'mailboxes'
      ? [
          {
            id: 'last_synced_at',
            header: 'Última sincronização',
            sortable: true,
            cell: (v: MeteredRow) =>
              v.last_synced_at ? new Date(v.last_synced_at).toLocaleString('pt-BR') : 'Pendente',
          },
        ]
      : []),
    { id: 'quality', header: 'Medição', cell: (v) => storageQuality[v.quality] },
    {
      id: 'measured_at',
      header: 'Data e hora',
      cell: (v) => new Date(v.measured_at).toLocaleString('pt-BR'),
    },
  ];
  const reset = (next: Scope) => {
    setDetail(null);
    onChange(
      { ...query, page: 1, search: undefined, sort: undefined, filters: {} },
      next,
      tenantId,
    );
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/superadmin/metering/export?' + params, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = 'armazenamento.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Não foi possível exportar os dados.');
    } finally {
      setExporting(false);
    }
  };
  const company = usage.data?.selected_tenant;
  const summary = company ?? usage.data?.summary;
  const visibleDetail =
    detail &&
    (scope === 'tenants' ? detail.scope === 'tenant' : detail.scope === 'mailbox') &&
    (!tenantId || detail.tenant_id === tenantId)
      ? (usage.data?.items.find((v) => v.id === detail.id) ?? detail)
      : null;
  return (
    <section className="space-y-4" aria-label="Armazenamento da plataforma">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={scope === 'tenants' ? 'default' : 'outline'}
          onClick={() => reset('tenants')}
        >
          Por empresa
        </Button>
        <Button
          variant={scope === 'mailboxes' ? 'default' : 'outline'}
          onClick={() => reset('mailboxes')}
        >
          Por caixa
        </Button>
        <Button variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
          Reconciliar arquivos
        </Button>
        <Button
          variant="outline"
          disabled={exporting || !usage.data?.total}
          onClick={() => void exportCsv()}
        >
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Dados atribuídos = payload lógico salvo + arquivos únicos presentes. O total físico do
        PostgreSQL é compartilhado e aparece no dashboard.{' '}
        {lockTenant ? 'Empresa selecionada.' : 'Visão consolidada da plataforma.'}
      </p>
      {company && (
        <p className="text-sm font-semibold">
          {company.name}: resumo de todas as caixas e dos dados compartilhados da empresa. Os
          filtros abaixo afetam a listagem.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Dados atribuídos', summary?.attributed_bytes],
          ['Arquivos presentes', summary?.file_bytes],
          ['Dados lógicos', summary?.logical_bytes],
          ['Disco alocado aos arquivos', summary?.allocated_bytes],
        ].map(([label, value]) => (
          <div className="rounded-lg border bg-card p-4" key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{formatStorageBytes(value)}</p>
          </div>
        ))}
      </div>
      {company && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              'Compartilhado na empresa',
              formatStorageBytes(
                company.shared_file_bytes != null && company.shared_logical_bytes != null
                  ? String(BigInt(company.shared_file_bytes) + BigInt(company.shared_logical_bytes))
                  : null,
              ),
            ],
            ['Dados retidos', formatStorageBytes(company.retained_bytes)],
            [
              'Mensagens / arquivos físicos',
              `${company.messages.toLocaleString('pt-BR')} / ${company.files.toLocaleString('pt-BR')}`,
            ],
            [
              'Crescimento no período',
              company.growth_bytes == null
                ? 'Sem comparação'
                : formatStorageBytes(company.growth_bytes),
            ],
          ].map(([label, value]) => (
            <article key={label} className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
            </article>
          ))}
        </div>
      )}
      <div role="status" className="space-y-1 rounded-lg border bg-muted p-3 text-sm">
        <p>
          {usage.data?.measured_at
            ? `Última medição: ${new Date(usage.data.measured_at).toLocaleString('pt-BR')}`
            : 'Aguardando a primeira medição do worker.'}
          {usage.data?.stale ? ' · Medição pendente ou desatualizada.' : ''}
        </p>
        <p>
          {summary?.discrepancies ?? 0} divergências · Inventário:{' '}
          {usage.data?.latest_scan?.state ?? 'pendente'} ·{' '}
          {usage.data?.latest_scan?.checked_files ?? '0'} arquivos conferidos.
        </p>
        <p>
          Último inventário completo:{' '}
          {usage.data?.latest_full_scan?.finished_at
            ? new Date(usage.data.latest_full_scan.finished_at).toLocaleString('pt-BR')
            : 'Pendente'}{' '}
          · {usage.data?.latest_full_scan?.state ?? 'pendente'}. A publicação dos totais e a
          conferência completa do disco têm horários distintos.
        </p>
      </div>
      <ConfigurableTable
        listKey={'platform-metered-' + scope}
        mode="server"
        query={query}
        onQueryChange={(v) => onChange(v, scope, tenantId)}
        columns={columns}
        data={usage.data?.items ?? []}
        total={usage.data?.total ?? 0}
        isLoading={usage.isLoading}
        isFetching={usage.isFetching}
        error={usage.error}
        onRetry={() => void usage.refetch()}
        searchPlaceholder="Buscar empresa, caixa ou e-mail…"
        filters={[
          {
            id: 'quality',
            label: 'Medição',
            options: [
              { value: 'verified', label: 'Verificada' },
              { value: 'pending', label: 'Pendente' },
              { value: 'partial', label: 'Parcial' },
            ],
          },
          {
            id: 'retained',
            label: 'Cadastro',
            options: [
              { value: 'active', label: 'Ativo' },
              { value: 'retained', label: 'Excluído, dados retidos' },
            ],
          },
        ]}
        rowActions={(v) => (
          <Button variant="outline" size="sm" onClick={() => setDetail(v)}>
            Detalhar
          </Button>
        )}
      />
      {visibleDetail && (
        <section
          className="space-y-3 rounded-lg border bg-card p-4"
          aria-label="Detalhes de armazenamento"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="text-xl font-semibold">{visibleDetail.name}</h2>
            <Button variant="outline" size="sm" onClick={() => setDetail(null)}>
              Fechar detalhe
            </Button>
          </div>
          <p className="text-sm">
            {storageQuality[visibleDetail.quality]} · {visibleDetail.files} arquivos físicos únicos
            · {formatStorageBytes(visibleDetail.retained_bytes)} em dados retidos. · Crescimento no
            período:{' '}
            {visibleDetail.growth_bytes == null
              ? 'Sem duas medições verificadas'
              : formatStorageBytes(visibleDetail.growth_bytes)}
            .
          </p>
          <p className="text-sm text-muted-foreground">
            Medição: {new Date(visibleDetail.measured_at).toLocaleString('pt-BR')} · Dados
            compartilhados da empresa: {formatStorageBytes(visibleDetail.shared_logical_bytes)}{' '}
            lógicos e {formatStorageBytes(visibleDetail.shared_file_bytes)} em arquivos. Retidos:{' '}
            {formatStorageBytes(visibleDetail.retained_logical_bytes)} lógicos e{' '}
            {formatStorageBytes(visibleDetail.retained_file_bytes)} em arquivos. Retenção é parte do
            total, não uma soma adicional.
          </p>
          <StorageComposition categories={visibleDetail.categories} />
          <details>
            <summary className="cursor-pointer text-sm text-primary">
              Consultar bytes exatos por categoria
            </summary>
            <div className="mt-3">
              <ConfigurableTable
                listKey="platform-storage-category-bytes"
                mode="client"
                query={categoryQuery}
                onQueryChange={setCategoryQuery}
                data={visibleDetail.categories.map((value) => ({
                  ...value,
                  id: value.category,
                  category: categoryLabels[value.category] ?? value.category,
                }))}
                columns={[
                  { id: 'category', header: 'Categoria', hideable: false },
                  {
                    id: 'logical_bytes',
                    header: 'Dados lógicos (B)',
                    align: 'right',
                    cell: (value) => BigInt(value.logical_bytes).toLocaleString('pt-BR'),
                  },
                  {
                    id: 'file_bytes',
                    header: 'Arquivos (B)',
                    align: 'right',
                    cell: (value) => BigInt(value.file_bytes).toLocaleString('pt-BR'),
                  },
                ]}
              />
            </div>
          </details>
          <p className="text-sm text-muted-foreground">
            Arquivos compartilhados por caixas são contabilizados uma vez na empresa. Avatares
            globais pertencem à plataforma. Arquivos ausentes não são somados; divergências
            permanecem visíveis.
          </p>
          <StorageHistory
            tenantId={visibleDetail.tenant_id ?? undefined}
            mailboxId={visibleDetail.mailbox_id ?? undefined}
            period={period}
          />
        </section>
      )}
      {!visibleDetail && (
        <StorageComposition
          categories={company?.categories ?? usage.data?.summary_categories ?? []}
        />
      )}
      <StorageHistory tenantId={tenantId} period={period} />
    </section>
  );
}
