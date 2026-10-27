import { useQuery } from '@tanstack/react-query';
import type { ListQuery } from '@apmail/shared';
import { ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { EmptyState } from '@/components/data/data-state';
import { StatusBadge } from '@/components/common/status-badge';
type Decision = {
  id: string;
  filename: string;
  action: 'release' | 'revoke';
  actor_name: string | null;
  rule_id: string | null;
  reason: string;
  false_positive: boolean;
  scan_status: string;
  threat_name: string | null;
  created_at: string;
};
export function AntivirusDecisions({
  query,
  onQueryChange,
}: {
  query: ListQuery;
  onQueryChange: (q: ListQuery) => void;
}) {
  const tenant = useTenantId(),
    me = useQuery(meQuery).data;
  const params = new URLSearchParams({
    page: String(query.page),
    page_size: String(query.pageSize),
  });
  const result = useQuery({
    queryKey: ['antivirus-decisions', tenant, params.toString()],
    queryFn: ({ signal }) =>
      api<{ items: Decision[]; total: number }>('/security/antivirus/decisions?' + params, {
        signal,
      }),
  });
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Registro das liberações manuais, regras automáticas e revogações individuais. Alterações das
        regras também ficam na auditoria da empresa.
      </p>
      <ConfigurableTable<Decision>
        listKey="antivirus-decisions-v1"
        mode="server"
        query={query}
        onQueryChange={onQueryChange}
        showSearch={false}
        data={result.data?.items ?? []}
        total={result.data?.total ?? 0}
        isLoading={result.isLoading}
        error={result.error}
        onRetry={() => void result.refetch()}
        emptyState={
          <EmptyState
            icon={ClipboardCheck}
            title="Nenhuma decisão registrada"
            description="As liberações e revogações de anexos aparecerão aqui, com responsável e motivo."
          />
        }
        columns={[
          {
            id: 'filename',
            header: 'Arquivo',
            sortable: false,
            cell: (row) => (
              <span className="block max-w-64 truncate font-medium" title={row.filename}>
                {row.filename}
              </span>
            ),
          },
          {
            id: 'decision',
            header: 'Decisão',
            sortable: false,
            cell: (row) => (
              <div className="space-y-1">
                <StatusBadge
                  label={
                    row.action === 'revoke'
                      ? 'Liberação revogada'
                      : row.rule_id
                        ? 'Regra de confiança'
                        : 'Liberação manual'
                  }
                  variant={row.action === 'revoke' ? 'warning' : 'info'}
                />
                {row.false_positive && (
                  <p className="text-xs text-muted-foreground">Possível falso positivo</p>
                )}
              </div>
            ),
          },
          {
            id: 'reason',
            header: 'Motivo',
            sortable: false,
            cell: (row) => <p className="max-w-80 whitespace-normal text-xs">{row.reason}</p>,
          },
          {
            id: 'actor',
            header: 'Responsável',
            sortable: false,
            cell: (row) => row.actor_name ?? 'Sistema',
          },
          {
            id: 'finding',
            header: 'Resultado original',
            sortable: false,
            cell: (row) => (
              <span className="block max-w-56 break-all font-mono text-xs">
                {row.threat_name ?? row.scan_status}
              </span>
            ),
          },
          {
            id: 'created',
            header: 'Data',
            sortable: false,
            cell: (row) => (
              <span className="whitespace-nowrap tabular-nums">
                {new Date(row.created_at).toLocaleString('pt-BR', {
                  timeZone: me?.preferences.timezone ?? 'America/Sao_Paulo',
                })}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
