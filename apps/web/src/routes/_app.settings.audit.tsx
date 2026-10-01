import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { listQuerySchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { api } from '@/lib/api';
import { requireAdmin } from '@/lib/settings';
import { format } from 'date-fns';
type Entry = {
  id: string;
  action: string;
  actor_name: string | null;
  entity_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
};
export const Route = createFileRoute('/_app/settings/audit')({
  beforeLoad: requireAdmin,
  validateSearch: listQuerySchema,
  component: Audit,
});
function Audit() {
  const query = Route.useSearch();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['audit', query],
    queryFn: ({ signal }) =>
      api<{ items: Entry[]; total: number }>(
        '/audit-logs?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            ...(query.search ? { action: query.search } : {}),
          }),
        { signal },
      ),
  });
  return (
    <>
      <PageHeader title="Auditoria" description="Acompanhe alterações e acessos da equipe." />
      <ConfigurableTable
        listKey="audit-logs"
        mode="server"
        columns={[
          { id: 'action', header: 'Ação', hideable: false },
          { id: 'actor_name', header: 'Usuário' },
          { id: 'entity_type', header: 'Registro' },
          {
            id: 'created_at',
            header: 'Data',
            cell: (e) => format(new Date(e.created_at), 'dd/MM/yyyy HH:mm'),
          },
          {
            id: 'metadata',
            header: 'Detalhes',
            cell: (e) => (
              <details>
                <summary>Ver alterações</summary>
                <pre className="max-w-80 overflow-auto whitespace-pre-wrap font-mono text-xs">
                  {JSON.stringify(e.metadata, null, 2)}
                </pre>
              </details>
            ),
          },
        ]}
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        query={query}
        onQueryChange={(search) => void navigate({ to: '/settings/audit', search })}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    </>
  );
}
