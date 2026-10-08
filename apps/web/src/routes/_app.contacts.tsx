import { useState } from 'react';
import { z } from 'zod';
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
import { ContactImportDialog } from '@/components/contacts/contact-import';
import { toast } from 'sonner';
type Row = {
  id: string;
  name: string;
  phone: string;
  emails: string[];
  nickname: string;
  job_title: string;
  company: string;
  scope: 'tenant' | 'personal';
  primary_email: string | null;
};
export const Route = createFileRoute('/_app/contacts')({
  validateSearch: listQuerySchema.extend({ contactId: z.uuid().optional() }),
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
    canDelegate(tenant?.role ?? null, tenant?.capabilities, 'contacts_manage');
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const selected = editing !== undefined ? editing : query.contactId;
  const q = useQuery({
    queryKey: ['contacts', tenantId, me?.user.id, query],
    queryFn: ({ signal }) =>
      api<ListResult<Row>>(
        '/contacts?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
            sort: query.sort?.key ?? 'name',
            columns: JSON.stringify(
              Object.fromEntries(
                Object.entries(query.filters)
                  .filter(([k]) => k.startsWith('column:'))
                  .map(([k, v]) => [k.slice(7), v]),
              ),
            ),
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
        description="Contatos globais da empresa e sua agenda individual."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              Importar
            </Button>
            <Button onClick={() => setEditing(null)}>
              <UserPlus />
              Novo contato
            </Button>
          </div>
        }
      />
      <ConfigurableTable
        listKey="contacts"
        searchPlaceholder="Buscar nome, empresa, apelido, e-mail ou telefone…"
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
          { id: 'nickname', header: 'Meu apelido', sortable: true },
          {
            id: 'scope',
            header: 'Visibilidade',
            cell: (r) => (r.scope === 'tenant' ? 'Global' : 'Individual'),
            sortable: true,
          },
          {
            id: 'company',
            header: 'Empresa',
            sortable: true,
            cell: (r) => r.company || 'Sem empresa',
          },
          {
            id: 'emails',
            header: 'E-mails',
            sortable: true,
            cell: (r) => (
              <span title={r.emails.join(', ')}>
                {r.primary_email ?? r.emails[0]}
                {r.emails.length > 1 ? ` (+${r.emails.length - 1})` : ''}
              </span>
            ),
          },
          { id: 'phone', header: 'Telefone', sortable: true },
          { id: 'job_title', header: 'Cargo', sortable: true, defaultVisible: false },
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
            {(mayControl || row.scope === 'personal') && (
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
                  await client.invalidateQueries({ queryKey: ['global-search'] });
                  toast.success('Contato excluído.');
                }}
              />
            )}
          </div>
        )}
      />
      {importing && <ContactImportDialog onClose={() => setImporting(false)} />}
      {selected !== undefined && (
        <ContactEditorDialog
          id={selected ?? undefined}
          onClose={() => {
            setEditing(undefined);
            if (query.contactId)
              void navigate({ to: '/contacts', search: { ...query, contactId: undefined } });
          }}
        />
      )}
    </>
  );
}
