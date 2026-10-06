import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { listQuerySchema, ROLE_LABELS, type ListResult, type TenantRole } from '@apmail/shared';
import { requireUser, meQuery } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { toast } from 'sonner';
import { PlatformStorage } from '@/components/platform/platform-storage';
import {
  PlatformOverviewDashboard,
  PlatformIntegrity,
} from '@/components/platform/platform-overview';
import {
  PlatformManagementDialog,
  type ManagementDialog,
  type PlatformRow,
} from '@/components/platform/platform-management-dialog';
import { useTheme } from '@/components/layout/theme-provider';
import { TenantStorage } from '@/components/storage/storage-quotas';

const sections = [
  'overview',
  'tenants',
  'users',
  'mailboxes',
  'storage',
  'integrity',
  'audit',
  'logs',
  'health',
] as const;
const labels = {
  overview: 'Dashboard',
  integrity: 'Integridade',
  tenants: 'Empresa',
  users: 'Usuários',
  mailboxes: 'Caixas de e-mail',
  storage: 'Armazenamento',
  audit: 'Auditoria',
  logs: 'Logs',
  health: 'Saúde da plataforma',
};
export const Route = createFileRoute('/superadmin')({
  beforeLoad: async () => {
    const me = await requireUser();
    if (!me.platform_admin)
      throw new ApiError(
        403,
        'forbidden',
        'Somente o superadmin pode acessar a gestão da plataforma.',
      );
  },
  validateSearch: listQuerySchema.extend({
    section: z.enum(sections).default('overview'),
    storage_period: z.enum(['24h', '7d', '30d', '90d', '24mo']).default('30d'),
    tenant_id: z.uuid().optional(),
    storage_scope: z.enum(['tenants', 'mailboxes']).default('tenants'),
    storage_tenant: z.uuid().optional(),
  }),
  component: SuperAdmin,
});
function SuperAdmin() {
  const query = Route.useSearch(),
    navigate = useNavigate(),
    client = useQueryClient();
  const tenantId = query.tenant_id ?? query.storage_tenant;
  // A company is selected before exposing tenant management, even for old bookmarked URLs.
  const section =
    tenantId || ['overview', 'storage', 'integrity', 'health'].includes(query.section)
      ? query.section
      : 'tenants';
  const [dialog, setDialog] = useState<ManagementDialog | null>(null);
  const me = useQuery(meQuery).data;
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (me?.preferences.theme === 'light' || me?.preferences.theme === 'dark')
      setTheme(me.preferences.theme);
  }, [me?.preferences.theme, setTheme]);
  const themeChange = useMutation({
    mutationFn: (next: 'light' | 'dark') =>
      api('/preferences', { method: 'PUT', body: { theme: next } }),
    onSuccess: async (_, next) => {
      setTheme(next);
      await client.invalidateQueries({ queryKey: ['me'] });
    },
    onError: () => toast.error('Não foi possível salvar o tema.'),
  });
  const company = useQuery({
    queryKey: ['platform', 'company', tenantId],
    queryFn: () => api<PlatformRow>('/superadmin/tenants/' + tenantId),
    enabled: !!tenantId,
  });
  const q = useQuery({
    queryKey: ['platform', section, tenantId, query.page, query.pageSize, query.search],
    queryFn: ({ signal }) =>
      api<ListResult<PlatformRow>>(
        '/superadmin/' +
          section +
          '?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
            ...(tenantId ? { tenant_id: tenantId } : {}),
          }),
        { signal },
      ),
    enabled:
      (!tenantId && section === 'tenants') ||
      (!!company.data &&
        !['overview', 'integrity', 'health', 'storage', 'tenants'].includes(section)),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === section && previousQuery.queryKey[2] === tenantId
        ? previous
        : undefined,
  });
  const health = useQuery({
    queryKey: ['platform', 'health'],
    queryFn: () =>
      api<{
        database: string;
        redis: string;
        queues: Record<string, Record<string, number>>;
        worker_last_heartbeat: string | null;
        global_smtp_configured: boolean;
      }>('/superadmin/health'),
    enabled: section === 'health',
    refetchInterval: section === 'health' ? 30000 : false,
  });
  const columns: Record<string, ListColumn<PlatformRow>[]> = {
    tenants: [
      { id: 'name', header: 'Empresa', hideable: false },
      { id: 'slug', header: 'Identificador' },
      { id: 'users', header: 'Usuários', align: 'right' },
      { id: 'mailboxes', header: 'Caixas', align: 'right' },
      {
        id: 'suspended_at',
        header: 'Situação',
        cell: (r) => (r.suspended_at ? 'Suspensa' : 'Ativa'),
      },
    ],
    users: [
      { id: 'full_name', header: 'Nome', hideable: false },
      { id: 'email', header: 'E-mail' },
      {
        id: 'tenant_role',
        header: 'Papel',
        cell: (r) => ROLE_LABELS[r.tenant_role as TenantRole] ?? String(r.tenant_role ?? ''),
      },
      {
        id: 'member_status',
        header: 'Acesso',
        cell: (r) => (r.member_status === 'active' ? 'Ativo' : 'Desativado'),
      },
      {
        id: 'last_login_at',
        header: 'Último acesso',
        cell: (r) =>
          r.last_login_at ? new Date(String(r.last_login_at)).toLocaleString('pt-BR') : 'Nunca',
      },
    ],
    mailboxes: [
      { id: 'name', header: 'Caixa', hideable: false },
      { id: 'email_address', header: 'E-mail' },
      { id: 'status', header: 'Status' },
      {
        id: 'last_synced_at',
        header: 'Última sincronização',
        cell: (r) =>
          r.last_synced_at
            ? new Date(String(r.last_synced_at)).toLocaleString('pt-BR')
            : 'Pendente',
      },
    ],
    audit: [
      {
        id: 'created_at',
        header: 'Data e hora',
        hideable: false,
        cell: (r) => new Date(String(r.created_at)).toLocaleString('pt-BR'),
      },
      { id: 'actor_name', header: 'Usuário' },
      { id: 'action', header: 'Ação' },
      {
        id: 'metadata',
        header: 'Detalhes',
        cell: (r) => (
          <pre className="max-w-80 whitespace-pre-wrap text-xs">{JSON.stringify(r.metadata)}</pre>
        ),
      },
    ],
    logs: [
      {
        id: 'created_at',
        header: 'Data e hora',
        hideable: false,
        cell: (r) => new Date(String(r.created_at)).toLocaleString('pt-BR'),
      },
      { id: 'service', header: 'Serviço' },
      { id: 'level', header: 'Nível' },
      { id: 'message', header: 'Mensagem' },
      { id: 'request_id', header: 'Protocolo' },
    ],
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['platform'] });
    await client.invalidateQueries({ queryKey: ['me'] });
  };
  const switchContext = (nextId?: string) => {
    setDialog(null);
    void navigate({
      to: '/superadmin',
      search: {
        page: 1,
        pageSize: query.pageSize,
        filters: {},
        section: nextId ? 'users' : 'tenants',
        tenant_id: nextId,
        storage_scope: 'tenants',
      },
    });
  };
  const open = (kind: ManagementDialog['kind'], row?: PlatformRow) =>
    setDialog({ kind, row, tenantId });
  const visibleDialog =
    dialog &&
    (dialog.kind === 'tenant-create' ||
      (dialog.kind === 'tenant-edit' && !tenantId) ||
      dialog.tenantId === tenantId)
      ? dialog
      : null;
  const available = !!company.data && !company.data.suspended_at;
  const changeStatus = async (row: PlatformRow) => {
    await api('/superadmin/users/' + row.id + '/status', {
      method: 'PUT',
      body: { tenant_id: tenantId, status: row.member_status === 'active' ? 'disabled' : 'active' },
    });
    await refresh();
  };
  return (
    <main className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-screen-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">APMail · Administração</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={themeChange.isPending}
              onClick={() => themeChange.mutate(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' });
                client.clear();
                await navigate({ to: '/login' });
              }}
            >
              Sair
            </Button>
          </div>
        </div>
        <PageHeader
          title="Gestão da plataforma"
          description={
            section === 'overview'
              ? 'Acompanhe consumo, crescimento e saúde de toda a plataforma.'
              : tenantId
                ? 'Gerencie os cadastros e o armazenamento da empresa selecionada.'
                : 'Selecione uma empresa para gerenciar seus usuários, caixas de e-mail e configurações.'
          }
          actions={
            section === 'tenants' ? (
              <Button onClick={() => open('tenant-create')}>Criar empresa</Button>
            ) : section === 'users' && tenantId ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!available} onClick={() => open('invite')}>
                  Convidar por e-mail
                </Button>
                <Button disabled={!available} onClick={() => open('user-create')}>
                  Adicionar usuário
                </Button>
              </div>
            ) : section === 'mailboxes' && tenantId ? (
              <Button disabled={!available} onClick={() => open('mailbox-create')}>
                Adicionar caixa
              </Button>
            ) : undefined
          }
        />
        {tenantId && (
          <section
            aria-label="Empresa selecionada"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
          >
            <div>
              <p className="text-xs text-muted-foreground">Empresa selecionada</p>
              <p className="font-semibold">{company.data?.name ?? 'Carregando empresa…'}</p>
              {company.data?.suspended_at && (
                <p className="text-sm text-muted-foreground">
                  Suspensa. Reative a empresa para adicionar usuários ou caixas.
                </p>
              )}
            </div>
            <Button variant="outline" onClick={() => switchContext()}>
              Trocar empresa
            </Button>
          </section>
        )}
        <nav aria-label="Gestão da plataforma" className="flex flex-wrap gap-2">
          {(tenantId
            ? sections
            : (['overview', 'tenants', 'storage', 'integrity', 'health'] as const)
          ).map((item) => (
            <Button
              key={item}
              variant={item === section ? 'default' : 'outline'}
              aria-current={item === section ? 'page' : undefined}
              onClick={() => {
                setDialog(null);
                void navigate({
                  to: '/superadmin',
                  search: {
                    ...query,
                    tenant_id: tenantId,
                    storage_tenant: undefined,
                    section: item,
                    page: 1,
                    search: undefined,
                    sort: undefined,
                    filters: {},
                  },
                });
              }}
            >
              {item === 'tenants' && !tenantId ? 'Empresas' : labels[item]}
            </Button>
          ))}
        </nav>
        {['overview', 'storage'].includes(section) && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="storage-period" className="text-sm">
              Período do histórico
            </label>
            <select
              id="storage-period"
              className="h-10 rounded-md border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
              value={query.storage_period}
              onChange={(e) =>
                void navigate({
                  to: '/superadmin',
                  search: {
                    ...query,
                    storage_period: e.target.value as typeof query.storage_period,
                    page: 1,
                  },
                })
              }
            >
              {Object.entries({
                '24h': '24 horas',
                '7d': '7 dias',
                '30d': '30 dias',
                '90d': '90 dias',
                '24mo': '24 meses',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        {tenantId && company.isLoading ? (
          <LoadingState />
        ) : tenantId && company.error ? (
          <ErrorState onRetry={() => void company.refetch()} />
        ) : section === 'overview' ? (
          <PlatformOverviewDashboard
            onSelectTenant={(id) =>
              void navigate({
                to: '/superadmin',
                search: {
                  ...query,
                  tenant_id: id,
                  section: 'storage',
                  storage_scope: 'mailboxes',
                  page: 1,
                  sort: undefined,
                  search: undefined,
                  filters: {},
                },
              })
            }
            period={query.storage_period}
            onManage={() =>
              void navigate({
                to: '/superadmin',
                search: {
                  ...query,
                  section: 'tenants',
                  tenant_id: undefined,
                  storage_tenant: undefined,
                  page: 1,
                },
              })
            }
            onStorage={() =>
              void navigate({
                to: '/superadmin',
                search: { ...query, section: 'storage', page: 1 },
              })
            }
          />
        ) : section === 'integrity' ? (
          <PlatformIntegrity
            query={query}
            tenantId={tenantId}
            onChange={(next) => void navigate({ to: '/superadmin', search: { ...query, ...next } })}
          />
        ) : section === 'health' ? (
          health.isLoading ? (
            <LoadingState />
          ) : health.error ? (
            <ErrorState onRetry={() => void health.refetch()} />
          ) : (
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-xl font-semibold">Serviços da plataforma</h2>
              <p>
                Banco: {health.data?.database} · Redis: {health.data?.redis}
              </p>
              <p>SMTP global: {health.data?.global_smtp_configured ? 'Configurado' : 'Pendente'}</p>
              <p>
                Último sinal do worker:{' '}
                {health.data?.worker_last_heartbeat
                  ? new Date(health.data.worker_last_heartbeat).toLocaleString('pt-BR')
                  : 'Indisponível'}
              </p>
              {Object.entries(health.data?.queues ?? {}).map(([queue, counts]) => (
                <p key={queue} className="text-sm">
                  <strong>{queue}</strong>:{' '}
                  {Object.entries(counts)
                    .map(([state, count]) => `${state}: ${count}`)
                    .join(' · ')}
                </p>
              ))}
            </section>
          )
        ) : section === 'tenants' && tenantId ? (
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-xl font-semibold">Cadastro da empresa</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Nome</dt>
                <dd>{company.data?.name}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Identificador</dt>
                <dd>{company.data?.slug}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => open('tenant-edit', company.data)}>
                Editar empresa
              </Button>
              <ConfirmDialog
                title={company.data?.suspended_at ? 'Reativar empresa?' : 'Suspender empresa?'}
                description="A suspensão bloqueia o acesso e novos envios desta empresa."
                trigger={
                  <Button variant="outline">
                    {company.data?.suspended_at ? 'Reativar empresa' : 'Suspender empresa'}
                  </Button>
                }
                onConfirm={async () => {
                  await api('/superadmin/tenants/' + tenantId, {
                    method: 'PATCH',
                    body: { suspended: !company.data?.suspended_at },
                  });
                  await refresh();
                }}
              />
            </div>
          </section>
        ) : section === 'storage' ? (
          <PlatformStorage
            query={query}
            scope={query.storage_scope}
            tenantId={tenantId}
            lockTenant={!!tenantId}
            period={query.storage_period}
            onChange={(next, scope, nextTenant) =>
              void navigate({
                to: '/superadmin',
                search: {
                  ...query,
                  ...next,
                  section,
                  tenant_id: nextTenant,
                  storage_scope: scope,
                  storage_tenant: undefined,
                },
              })
            }
          />
        ) : (
          <ConfigurableTable
            listKey={'platform-' + section}
            mode="server"
            query={query}
            onQueryChange={(next) =>
              void navigate({
                to: '/superadmin',
                search: {
                  ...next,
                  section,
                  tenant_id: tenantId,
                  storage_tenant: undefined,
                  storage_scope: query.storage_scope,
                },
              })
            }
            columns={columns[section] ?? []}
            data={q.data?.items ?? []}
            total={q.data?.total ?? 0}
            isLoading={q.isLoading}
            isFetching={q.isFetching}
            error={q.error}
            onRetry={() => void q.refetch()}
            searchPlaceholder={
              section === 'tenants'
                ? 'Buscar empresa…'
                : section === 'users'
                  ? 'Buscar nome ou e-mail…'
                  : section === 'mailboxes'
                    ? 'Buscar caixa ou e-mail…'
                    : section === 'audit'
                      ? 'Buscar ação…'
                      : 'Buscar serviço, nível ou mensagem…'
            }
            rowActions={(row) =>
              section === 'tenants' ? (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => switchContext(row.id)}>
                    Gerenciar empresa
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog({ kind: 'tenant-edit', row, tenantId: row.id })}
                  >
                    Editar
                  </Button>
                </div>
              ) : section === 'mailboxes' ? (
                <Button size="sm" variant="outline" onClick={() => open('mailbox-edit', row)}>
                  Editar caixa
                </Button>
              ) : section === 'users' ? (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => open('user-edit', row)}>
                    Editar usuário
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => open('access', row)}>
                    Permissões
                  </Button>
                  <ConfirmDialog
                    title={
                      row.member_status === 'active' ? 'Desativar acesso?' : 'Reativar acesso?'
                    }
                    description="Esta alteração afeta somente o vínculo com a empresa selecionada. Deve existir um proprietário ativo."
                    trigger={
                      <Button size="sm" variant="ghost">
                        {row.member_status === 'active' ? 'Desativar' : 'Reativar'}
                      </Button>
                    }
                    onConfirm={() => changeStatus(row)}
                  />
                </div>
              ) : null
            }
          />
        )}
        {tenantId && ['tenants', 'storage'].includes(section) && (
          <TenantStorage key={tenantId} tenantId={tenantId} platform />
        )}
        <PlatformManagementDialog
          dialog={visibleDialog}
          tenantName={
            visibleDialog?.kind === 'tenant-edit' ? visibleDialog.row?.name : company.data?.name
          }
          onClose={() => setDialog(null)}
          onSaved={async (result) => {
            await refresh();
            if (result?.tenant) switchContext(result.tenant.id);
            else if (result?.user) setDialog({ kind: 'access', row: result.user, tenantId });
            else setDialog(null);
            toast.success('Cadastro atualizado.');
          }}
        />
      </div>
    </main>
  );
}
