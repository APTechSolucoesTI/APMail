import { useState } from 'react';
import { z } from 'zod';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { listQuerySchema, type CompanyDetail, type ListResult } from '@apmail/shared';
import { useTenantId } from '@/lib/auth';
import { api } from '@/lib/api';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { CompanyEditorDialog } from '@/components/contacts/company-editor';
import { useDirectoryControl } from '@/components/contacts/directory-fields';
import { Building2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
export const Route = createFileRoute('/_app/companies')({
  validateSearch: listQuerySchema.extend({ companyId: z.uuid().optional() }),
  component: Companies,
});
function Companies() {
  const tenant = useTenantId(),
    query = Route.useSearch(),
    navigate = useNavigate(),
    client = useQueryClient(),
    mayControl = useDirectoryControl(),
    [editing, setEditing] = useState<string | null | undefined>(undefined),
    selected = editing !== undefined ? editing : query.companyId;
  const q = useQuery({
    queryKey: ['companies', tenant, query],
    queryFn: ({ signal }) =>
      api<ListResult<CompanyDetail>>(
        '/companies?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
            sort: ['name', 'trade_name', 'cnpj', 'created_at'].includes(query.sort?.key ?? '')
              ? query.sort!.key
              : 'name',
            direction: query.sort?.direction ?? 'asc',
          }),
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Empresas"
        description="Cadastro de empresas vinculadas aos contatos desta organização."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Building2 aria-hidden />
            Nova empresa
          </Button>
        }
      />
      <ConfigurableTable
        listKey="companies"
        searchPlaceholder="Buscar CNPJ, razão social ou nome fantasia…"
        mode="server"
        query={query}
        onQueryChange={(search) => void navigate({ to: '/companies', search })}
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          { id: 'name', header: 'Razão social', hideable: false, sortable: true },
          { id: 'trade_name', header: 'Nome fantasia', sortable: true },
          { id: 'cnpj', header: 'CNPJ', sortable: true, cell: (r) => r.cnpj || 'Não informado' },
          { id: 'addresses', header: 'Endereços', cell: (r) => String(r.addresses.length) },
          {
            id: 'visibility',
            header: 'Exibição',
            cell: (r) => (r.visibility === 'all' ? 'Todas as caixas' : 'Caixas selecionadas'),
          },
        ]}
        rowActions={(row) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={'Editar ' + row.name}
              onClick={() => setEditing(row.id)}
            >
              <Pencil aria-hidden />
            </Button>
            {mayControl && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={'Excluir ' + row.name}>
                    <Trash2 aria-hidden className="text-destructive" />
                  </Button>
                }
                title="Excluir empresa?"
                description="A empresa será removida. Empresas vinculadas a contatos precisam ser desvinculadas primeiro."
                onConfirm={async () => {
                  await api('/companies/' + row.id, { method: 'DELETE' });
                  await client.invalidateQueries({
                    predicate: (q) =>
                      String(q.queryKey[0]).startsWith('compan') ||
                      q.queryKey[0] === 'global-search',
                  });
                  toast.success('Empresa excluída.');
                }}
              />
            )}
          </div>
        )}
      />
      {selected !== undefined && (
        <CompanyEditorDialog
          id={selected ?? undefined}
          onClose={() => {
            setEditing(undefined);
            if (query.companyId)
              void navigate({ to: '/companies', search: { ...query, companyId: undefined } });
          }}
        />
      )}
    </>
  );
}
