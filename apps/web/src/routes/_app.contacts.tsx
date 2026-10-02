import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { listQuerySchema, isTenantAdmin, canDelegate, type ListResult } from '@apmail/shared';
import { useTenantId, meQuery } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { Button } from '@/components/ui/button';
import { ContactEditorDialog } from '@/components/contacts/contact-editor';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pencil, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
type Row = { id: string; name: string; phone: string; emails: string[]; visibility: string };
export const Route = createFileRoute('/_app/contacts')({
  validateSearch: listQuerySchema,
  component: Contacts,
});
function Contacts() {
  const tenantId = useTenantId(),
    query = Route.useSearch(),
    navigate = useNavigate(),
    client = useQueryClient();
  const me = useQuery(meQuery).data,
    tenant = me?.tenants.find((t) => t.id === tenantId);
  const mayControl =
    isTenantAdmin(tenant?.role) ||
    canDelegate(tenant?.role ?? null, tenant?.capabilities, 'contacts_visibility');
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const q = useQuery({
    queryKey: ['contacts', tenantId, query],
    queryFn: ({ signal }) =>
      api<ListResult<Row>>(
        '/contacts?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
            sort: query.sort?.key === 'created_at' ? 'created_at' : 'name',
            direction: query.sort?.direction ?? 'asc',
          }),
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Contatos"
        description="Pessoas, e-mails, empresas e endereços compartilhados pela sua empresa."
        actions={
          <Button onClick={() => setEditing(null)}>
            <UserPlus />
            Novo contato
          </Button>
        }
      />
      <ConfigurableTable
        listKey="contacts"
        mode="server"
        query={query}
        onQueryChange={(search) => void navigate({ to: '/contacts', search })}
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          { id: 'name', header: 'Nome', hideable: false, sortable: true },
          {
            id: 'emails',
            header: 'E-mails',
            cell: (r) => <span title={r.emails.join(', ')}>{r.emails.join(', ')}</span>,
          },
          { id: 'phone', header: 'Telefone' },
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
              <Pencil />
            </Button>
            {mayControl && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={'Excluir ' + row.name}>
                    <Trash2 className="text-destructive" />
                  </Button>
                }
                title="Excluir contato?"
                description="O contato e seus vínculos serão removidos da empresa."
                onConfirm={async () => {
                  await api('/contacts/' + row.id, { method: 'DELETE' });
                  await client.invalidateQueries({ queryKey: ['contacts'] });
                  toast.success('Contato excluído.');
                }}
              />
            )}
          </div>
        )}
      />
      {editing !== undefined && (
        <ContactEditorDialog id={editing ?? undefined} onClose={() => setEditing(undefined)} />
      )}
    </>
  );
}
