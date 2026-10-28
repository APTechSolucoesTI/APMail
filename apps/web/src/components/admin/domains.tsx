import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  domainNameSchema,
  domainUpdateSchema,
  listQuerySchema,
  type ListQuery,
  type ListResult,
  type TenantDomain,
  type DomainDnsSnapshot,
} from '@apmail/shared';
import {
  Globe2,
  Plus,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
  Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId, useAccess } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { SchemaForm } from '@/components/forms/schema-form';
import { toast } from 'sonner';
function RecordStatus({ state }: { state?: string }) {
  const ok = state === 'present',
    bad = ['invalid', 'error'].includes(state ?? '');
  const Icon = ok ? CheckCircle2 : bad ? AlertTriangle : Info;
  return (
    <span
      className={
        'inline-flex items-center gap-1 text-xs ' +
        (ok ? 'text-success-fg' : bad ? 'text-warning-fg' : 'text-muted-foreground')
      }
    >
      <Icon className="size-3.5" />
      {ok
        ? 'Encontrado'
        : state === 'invalid'
          ? 'Revisar'
          : state === 'error'
            ? 'Falha na consulta'
            : state === 'missing'
              ? 'Não encontrado'
              : state === 'not_applicable'
                ? 'Não se aplica'
                : 'Não consultado'}
    </span>
  );
}
export function DomainList() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    manage = useAccess('domains.manage');
  const [query, setQuery] = useState<ListQuery>(listQuerySchema.parse({})),
    [open, setOpen] = useState(false);
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    search: query.search ?? '',
    sort: query.sort?.key === 'updated_at' ? 'checked_at' : 'domain',
    direction: query.sort?.direction ?? 'asc',
  });
  const q = useQuery({
    queryKey: ['domains', tenant, params.toString()],
    queryFn: () => api<ListResult<TenantDomain>>('/domains?' + params),
  });
  return (
    <>
      <PageHeader
        title="Domínios"
        description="Organize suas caixas e consulte a configuração pública de DNS."
        actions={
          manage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus />
              Adicionar domínio
            </Button>
          ) : undefined
        }
      />
      <div className="mb-5 flex items-start gap-3 rounded-lg border bg-card p-4 text-sm">
        <Globe2 className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          O APMail conecta contas existentes. O diagnóstico de DNS ajuda a identificar configurações
          que merecem atenção e não altera os registros do provedor.
        </p>
      </div>
      <ConfigurableTable<TenantDomain>
        listKey="admin-domains"
        mode="server"
        query={query}
        onQueryChange={setQuery}
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        isLoading={q.isPending}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        searchPlaceholder="Buscar domínio…"
        columns={[
          {
            id: 'domain',
            header: 'Domínio',
            hideable: false,
            sortable: true,
            filterable: false,
            value: (d) => d.domain,
            cell: (d) => (
              <Link
                className="font-medium text-primary hover:underline"
                to="/admin/domains/$domainId"
                params={{ domainId: d.id }}
              >
                {d.display_name}
                <span className="block text-xs font-normal text-muted-foreground">
                  {d.domain !== d.display_name ? d.domain : 'Configuração de e-mail'}
                </span>
              </Link>
            ),
          },
          ...(['mx', 'spf', 'dkim', 'dmarc'] as const).map((key) => ({
            id: key,
            header: key.toUpperCase(),
            sortable: false,
            filterable: false,
            cell: (d: TenantDomain) => <RecordStatus state={d.check?.records[key].state} />,
          })),
          {
            id: 'updated_at',
            header: 'Última consulta',
            sortable: true,
            filterable: false,
            value: (d) => d.check?.checked_at ?? '',
            cell: (d) =>
              d.check?.checked_at
                ? new Date(d.check.checked_at).toLocaleString('pt-BR')
                : 'Ainda não consultado',
          },
        ]}
        emptyState={
          <div className="p-8 text-center">
            <Globe2 className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-semibold">Nenhum domínio cadastrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione o domínio das contas que você deseja conectar.
            </p>
          </div>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar domínio</DialogTitle>
            <DialogDescription>
              Informe somente o domínio. A conta de e-mail é conectada separadamente.
            </DialogDescription>
          </DialogHeader>
          <SchemaForm
            schema={z.object({ domain: domainNameSchema })}
            fields={[{ name: 'domain', label: 'Domínio' }]}
            submitLabel="Adicionar domínio"
            onSubmit={async (b) => {
              await api('/domains', { method: 'POST', body: b });
              await client.invalidateQueries({ queryKey: ['domains'] });
              await client.invalidateQueries({ queryKey: ['admin-overview'] });
              setOpen(false);
              toast.success('Domínio adicionado.');
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
type DomainDetail = TenantDomain & {
  mailboxes: { id: string; name: string; email_address: string; status: string }[];
};
export function DomainDetail({ domainId }: { domainId: string }) {
  const navigate = useNavigate(),
    tenant = useTenantId(),
    client = useQueryClient(),
    manage = useAccess('domains.manage'),
    [remove, setRemove] = useState(false);
  const key = ['domain', tenant, domainId],
    q = useQuery({ queryKey: key, queryFn: () => api<DomainDetail>('/domains/' + domainId) });
  const check = useMutation({
    mutationFn: () =>
      api<{ snapshot: DomainDnsSnapshot }>('/domains/' + domainId + '/check-dns', {
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['domains'] });
      void client.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success('Consulta DNS concluída.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <>
      <Link
        to="/admin/domains"
        className="mb-4 inline-flex items-center gap-1 text-sm text-primary"
      >
        <ArrowLeft className="size-4" />
        Domínios
      </Link>
      <PageHeader
        title={d.display_name}
        description="Diagnóstico do domínio e caixas autorizadas vinculadas."
        actions={
          <Button onClick={() => check.mutate()} disabled={check.isPending}>
            <RefreshCw className={check.isPending ? 'animate-spin' : ''} />
            {check.isPending ? 'Consultando…' : 'Consultar DNS'}
          </Button>
        }
      />
      <p className="mb-5 text-xs text-muted-foreground">
        {d.check?.checked_at
          ? 'Última consulta: ' + new Date(d.check.checked_at).toLocaleString('pt-BR')
          : 'Este domínio ainda não foi consultado.'}{' '}
        Os resultados são informativos e não comprovam propriedade ou entrega.
      </p>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-lg border bg-card">
          <h2 className="border-b p-4 text-lg font-semibold">Registros de e-mail e DNS</h2>
          {(['mx', 'spf', 'dkim', 'dmarc', 'ns'] as const).map((kind) => {
            const record = d.check?.records[kind];
            return (
              <div key={kind} className="space-y-2 border-b p-4 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{kind.toUpperCase()}</h3>
                  <RecordStatus state={record?.state} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {record?.message ??
                    (kind === 'dkim' && !d.dkim_selector
                      ? 'Seletor DKIM não informado.'
                      : 'Consulte os registros para ver o diagnóstico.')}
                </p>
                {record?.source_domain && (
                  <p className="text-xs text-muted-foreground">
                    Política herdada de {record.source_domain}
                  </p>
                )}
                {record?.values.map((value, i) => (
                  <pre
                    key={i}
                    className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs"
                  >
                    {value}
                  </pre>
                ))}
              </div>
            );
          })}
        </section>
        <div className="space-y-5">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-lg font-semibold">Seletor DKIM</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Informe o seletor fornecido pela hospedagem para consultar a chave pública.
            </p>
            {manage ? (
              <SchemaForm
                key={d.dkim_selector ?? ''}
                schema={domainUpdateSchema}
                defaults={{ dkim_selector: d.dkim_selector ?? '' }}
                fields={[{ name: 'dkim_selector', label: 'Seletor DKIM' }]}
                onSubmit={async (b) => {
                  await api('/domains/' + domainId, { method: 'PATCH', body: b });
                  await client.invalidateQueries({ queryKey: key });
                  toast.success('Seletor atualizado. Consulte novamente o DNS.');
                }}
              />
            ) : (
              <p className="text-sm">{d.dkim_selector ?? 'Não informado'}</p>
            )}
          </section>
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-lg font-semibold">Caixas acessíveis</h2>
            {d.mailboxes.length ? (
              d.mailboxes.map((b) => (
                <div key={b.id} className="border-b py-3 last:border-0">
                  <p className="text-sm font-medium">{b.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{b.email_address}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma caixa vinculada disponível para seu acesso.
              </p>
            )}
          </section>
          {manage && (
            <Button variant="outline" className="text-destructive" onClick={() => setRemove(true)}>
              <Trash2 />
              Remover domínio
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        destructive
        title="Remover domínio?"
        description="Só é possível remover um domínio sem caixas vinculadas."
        onConfirm={async () => {
          await api('/domains/' + domainId, { method: 'DELETE' });
          await client.invalidateQueries({ queryKey: ['domains'] });
          await navigate({ to: '/admin/domains' });
        }}
      />
    </>
  );
}
