import { useQuery } from '@tanstack/react-query';
import type { ListQuery, PlatformStorageResult, StorageRow } from '@apmail/shared';
import { api } from '@/lib/api';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { Button } from '@/components/ui/button';

const bytes = (value: number) => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index =
    value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
  return `${(value / 1024 ** index).toLocaleString('pt-BR', { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
};
const byteCell = (value: number) => (
  <span className="whitespace-nowrap tabular-nums" title={`${value.toLocaleString('pt-BR')} bytes`}>
    {bytes(value)}
  </span>
);
type Scope = 'tenants' | 'mailboxes';

export function PlatformStorage({
  query,
  scope,
  tenantId,
  lockTenant = false,
  onChange,
}: {
  query: ListQuery;
  scope: Scope;
  tenantId?: string;
  lockTenant?: boolean;
  onChange: (query: ListQuery, scope: Scope, tenantId?: string) => void;
}) {
  const usage = useQuery({
    queryKey: [
      'platform',
      'storage',
      scope,
      tenantId,
      query.page,
      query.pageSize,
      query.search,
      query.sort,
    ],
    queryFn: ({ signal }) =>
      api<PlatformStorageResult>(
        '/superadmin/storage?' +
          new URLSearchParams({
            scope,
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
            ...(tenantId ? { tenant_id: tenantId } : {}),
            ...(query.sort ? { sort: query.sort.key, direction: query.sort.direction } : {}),
          }),
        { signal },
      ),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === tenantId && previousQuery?.queryKey[2] === scope
        ? previous
        : undefined,
  });
  const columns: ListColumn<StorageRow>[] = [
    {
      id: 'name',
      header: scope === 'tenants' ? 'Empresa' : 'Caixa',
      hideable: false,
      sortable: true,
      cell: (row) => (
        <span title={row.name}>
          {row.name}
          {row.retained_deleted && (
            <span className="ml-2 text-muted-foreground">(excluída, dados retidos)</span>
          )}
        </span>
      ),
    },
    ...(scope === 'mailboxes'
      ? [
          { id: 'tenant_name', header: 'Empresa', sortable: true },
          {
            id: 'email_address',
            header: 'E-mail',
            cell: (row: StorageRow) => (
              <span title={row.email_address ?? ''}>{row.email_address}</span>
            ),
          },
        ]
      : []),
    {
      id: 'messages',
      header: 'Mensagens',
      align: 'right',
      sortable: true,
      cell: (row) => row.messages.toLocaleString('pt-BR'),
    },
    ...(
      [
        'content_bytes',
        'attachment_bytes',
        ...(scope === 'tenants' ? ['shared_bytes' as const] : []),
        'total_bytes',
      ] as const
    ).map((id) => ({
      id,
      header: {
        content_bytes: 'Conteúdo salvo',
        attachment_bytes: 'Anexos',
        shared_bytes: 'Compartilhado',
        total_bytes: 'Total',
      }[id],
      align: 'right' as const,
      sortable: true,
      hideable: id !== 'total_bytes',
      cell: (row: StorageRow) => byteCell(row[id]),
    })),
  ];
  const reset = (nextScope: Scope, nextTenant?: string) =>
    onChange(
      { ...query, page: 1, search: undefined, sort: undefined, filters: {} },
      nextScope,
      lockTenant ? tenantId : nextTenant,
    );
  return (
    <section className="space-y-4" aria-label="Armazenamento da plataforma">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={scope === 'tenants' ? 'default' : 'outline'}
          aria-pressed={scope === 'tenants'}
          onClick={() => reset('tenants')}
        >
          Por empresa
        </Button>
        <Button
          variant={scope === 'mailboxes' ? 'default' : 'outline'}
          aria-pressed={scope === 'mailboxes'}
          onClick={() => reset('mailboxes')}
        >
          Por caixa
        </Button>
        {tenantId && !lockTenant && (
          <Button variant="outline" onClick={() => reset(scope)}>
            Limpar filtro de empresa
          </Button>
        )}
        <Button variant="outline" disabled={usage.isFetching} onClick={() => void usage.refetch()}>
          Atualizar uso
        </Button>
      </div>
      {tenantId && (
        <p className="text-sm text-muted-foreground">
          Caixas da empresa selecionada
          {usage.data?.items[0] ? `: ${usage.data.items[0].tenant_name}` : ''}.
        </p>
      )}
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-live="polite"
        aria-busy={usage.isFetching}
      >
        {(
          [
            ['Uso registrado', 'total_bytes'],
            ['Conteúdo salvo', 'content_bytes'],
            ['Anexos', 'attachment_bytes'],
            [
              scope === 'tenants' ? 'Compartilhado da empresa' : 'Mensagens armazenadas',
              scope === 'tenants' ? 'shared_bytes' : 'messages',
            ],
          ] as const
        ).map(([label, key]) => (
          <div key={key} className="rounded-lg border bg-card p-4 text-card-foreground">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {usage.error
                ? 'Indisponível'
                : !usage.data
                  ? '…'
                  : key === 'messages'
                    ? usage.data.summary[key].toLocaleString('pt-BR')
                    : byteCell(usage.data.summary[key])}
            </p>
          </div>
        ))}
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Estimativa dos dados de e-mail armazenados. Totais dos resultados filtrados.</p>
        <details>
          <summary className="cursor-pointer rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Como o uso é calculado
          </summary>
          <div className="mt-2 space-y-1">
            <p>
              Conteúdo salvo inclui corpos de mensagens e envios; compartilhado inclui uploads
              pendentes e assinaturas. Dados excluídos ainda retidos também contam.
            </p>
            <p>
              A estimativa usa os registros locais e exclui índices do banco, backups e RAM. O
              tamanho original do e-mail não é somado aos anexos. Arquivos com o mesmo caminho
              contam uma vez.
            </p>
          </div>
        </details>
        {scope === 'mailboxes' && (
          <p>
            Arquivos compartilhados da empresa aparecem na visão “Por empresa”, pois não pertencem a
            uma única caixa.
          </p>
        )}
        {usage.data && (
          <p>
            Consulta em {new Date(usage.data.measured_at).toLocaleString('pt-BR')}
            {usage.isFetching ? ' · Atualizando…' : ''}
          </p>
        )}
      </div>
      <ConfigurableTable<StorageRow>
        listKey={'platform-storage-' + scope}
        mode="server"
        searchPlaceholder={
          scope === 'tenants' ? 'Buscar empresa…' : 'Buscar empresa, caixa ou e-mail…'
        }
        query={query}
        onQueryChange={(next) => onChange(next, scope, tenantId)}
        columns={columns}
        data={usage.data?.items ?? []}
        total={usage.data?.total ?? 0}
        isLoading={usage.isLoading}
        isFetching={usage.isFetching}
        error={usage.error}
        onRetry={() => void usage.refetch()}
        rowActions={
          scope === 'tenants'
            ? (row) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reset('mailboxes', row.tenant_id)}
                >
                  Detalhar caixas
                </Button>
              )
            : undefined
        }
      />
    </section>
  );
}
