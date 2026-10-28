import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Video, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export const Route = createFileRoute('/_app/admin/reports')({ component: Reports });
function Reports() {
  const tenant = useTenantId(),
    catalog = useQuery({
      queryKey: ['meet-reports', tenant, 'catalog'],
      queryFn: () => api<{ id: string; name: string; description: string }[]>('/reports'),
    });
  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Consulte informações e exporte os dados autorizados da sua organização."
      />
      {catalog.isPending ? (
        <LoadingState />
      ) : catalog.isError ? (
        <ErrorState onRetry={() => void catalog.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalog.data.map((item) => (
            <Link
              key={item.id}
              to="/admin/reports/meet"
              search={{}}
              className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <Video className="size-5 text-primary" />
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </div>
              <h2 className="mt-4 text-sm font-semibold">{item.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
