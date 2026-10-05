import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { z } from 'zod';
import {
  listQuerySchema,
  tenantSchema,
  emailSchema,
  mailboxSchema,
  type ListResult,
} from '@apmail/shared';
import { requireUser, meQuery } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import { SchemaForm } from '@/components/forms/schema-form';
import { connectionFields } from '@/components/forms/mailbox-wizard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { toast } from 'sonner';
import { PlatformStorage } from '@/components/platform/platform-storage';
import { AccessEditor } from '@/components/forms/access-editor';
import { useTheme } from '@/components/layout/theme-provider';
const sections = ['tenants', 'users', 'mailboxes', 'storage', 'audit', 'logs', 'health'] as const;
const labels = {
  tenants: 'Empresas',
  users: 'Usuários',
  mailboxes: 'Conexões de e-mail',
  storage: 'Armazenamento',
  audit: 'Auditoria',
  logs: 'Logs',
  health: 'Saúde da plataforma',
};
type Row = {
  id: string;
  name?: string;
  slug?: string;
  suspended_at?: string | null;
  email_address?: string;
  tenant_id?: string;
  [key: string]: unknown;
};
export const Route = createFileRoute('/superadmin')({
  beforeLoad: async () => {
    const me = await requireUser();
    if (!me.platform_admin)
      throw new ApiError(
        403,
        'forbidden',
        'Somente o super admin pode acessar a gestão da plataforma.',
      );
  },
  validateSearch: listQuerySchema.extend({
    section: z.enum(sections).default('tenants'),
    storage_scope: z.enum(['tenants', 'mailboxes']).default('tenants'),
    storage_tenant: z.uuid().optional(),
  }),
  component: SuperAdmin,
});
function SuperAdmin() {
  const query = Route.useSearch(),
    section = query.section,
    navigate = useNavigate(),
    client = useQueryClient();
  const [dialog, setDialog] = useState<{
    kind: 'tenant' | 'mailbox' | 'credentials' | 'invite' | 'memberships' | 'access';
    row?: Row;
    tenantId?: string;
  } | null>(null);
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
  const companies = useQuery({
    queryKey: ['platform', 'tenant-options'],
    queryFn: () => api<ListResult<Row>>('/superadmin/tenants?pageSize=100'),
    enabled: dialog?.kind === 'mailbox' || dialog?.kind === 'invite',
  });
  const memberships = useQuery({
    queryKey: ['platform', 'memberships', dialog?.row?.id],
    queryFn: () =>
      api<{ tenant_id: string; name: string; role: string; status: string }[]>(
        '/superadmin/users/' + dialog?.row?.id + '/memberships',
      ),
    enabled: dialog?.kind === 'memberships',
  });
  const q = useQuery({
    queryKey: ['platform', section, query.page, query.pageSize, query.search],
    queryFn: ({ signal }) =>
      api<ListResult<Row>>(
        '/superadmin/' +
          section +
          '?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
          }),
        { signal },
      ),
    enabled: section !== 'health' && section !== 'storage',
    placeholderData: keepPreviousData,
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
  const columns: Record<string, ListColumn<Row>[]> = {
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
        id: 'platform_admin',
        header: 'Perfil',
        cell: (r) => (r.platform_admin ? 'Superadmin da plataforma' : 'Usuário de empresa'),
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
      { id: 'tenant_name', header: 'Empresa' },
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
      { id: 'tenant_id', header: 'Empresa' },
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
  return (
    <main className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-screen-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">APMail · Administração</span>
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
        <PageHeader
          title="Gestão da plataforma"
          description="Gerencie empresas, usuários, conexões e armazenamento da plataforma."
          actions={
            section === 'tenants' ? (
              <Button onClick={() => setDialog({ kind: 'tenant' })}>Criar empresa</Button>
            ) : section === 'mailboxes' ? (
              <Button onClick={() => setDialog({ kind: 'mailbox' })}>Conectar caixa</Button>
            ) : section === 'users' ? (
              <Button onClick={() => setDialog({ kind: 'invite' })}>Convidar usuário</Button>
            ) : undefined
          }
        />
        <nav aria-label="Gestão da plataforma" className="flex flex-wrap gap-2">
          {sections.map((item) => (
            <Button
              key={item}
              variant={item === section ? 'default' : 'outline'}
              onClick={() =>
                void navigate({
                  to: '/superadmin',
                  search: {
                    ...query,
                    section: item,
                    page: 1,
                    search: undefined,
                    sort: undefined,
                    storage_tenant: undefined,
                  },
                })
              }
              aria-current={item === section ? 'page' : undefined}
            >
              {labels[item]}
            </Button>
          ))}
        </nav>
        {section === 'health' ? (
          health.isLoading ? (
            <LoadingState />
          ) : health.error ? (
            <ErrorState onRetry={() => void health.refetch()} />
          ) : (
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-xl font-semibold">Serviços</h2>
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
        ) : section === 'storage' ? (
          <PlatformStorage
            query={query}
            scope={query.storage_scope}
            tenantId={query.storage_tenant}
            onChange={(next, scope, tenantId) =>
              void navigate({
                to: '/superadmin',
                search: { ...next, section, storage_scope: scope, storage_tenant: tenantId },
              })
            }
          />
        ) : (
          <ConfigurableTable
            listKey={'platform-' + section}
            mode="server"
            query={query}
            onQueryChange={(next) =>
              void navigate({ to: '/superadmin', search: { ...next, section } })
            }
            data={q.data?.items ?? []}
            total={q.data?.total ?? 0}
            columns={columns[section] ?? []}
            isLoading={q.isLoading}
            isFetching={q.isFetching}
            error={q.error}
            onRetry={() => void q.refetch()}
            rowActions={(row) =>
              section === 'tenants' ? (
                <div className="flex flex-wrap gap-1">
                  <ConfirmDialog
                    title={row.suspended_at ? 'Reativar empresa?' : 'Suspender empresa?'}
                    description="A suspensão bloqueia o acesso e novos envios desta empresa."
                    trigger={
                      <Button variant="ghost" size="sm">
                        {row.suspended_at ? 'Reativar' : 'Suspender'}
                      </Button>
                    }
                    onConfirm={async () => {
                      await api('/superadmin/tenants/' + row.id, {
                        method: 'PATCH',
                        body: { suspended: !row.suspended_at },
                      });
                      await refresh();
                    }}
                  />
                </div>
              ) : section === 'mailboxes' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ kind: 'credentials', row })}
                >
                  Atualizar credencial
                </Button>
              ) : section === 'users' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ kind: 'memberships', row })}
                >
                  Empresas e acesso
                </Button>
              ) : null
            }
          />
        )}
        <Dialog
          open={!!dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {dialog?.kind === 'tenant'
                  ? 'Criar empresa'
                  : dialog?.kind === 'mailbox'
                    ? 'Conectar caixa'
                    : dialog?.kind === 'credentials'
                      ? 'Atualizar credencial'
                      : dialog?.kind === 'invite'
                        ? 'Convidar usuário'
                        : dialog?.kind === 'memberships'
                          ? 'Empresas do usuário'
                          : dialog?.kind === 'access'
                            ? 'Permissões do usuário'
                            : 'Permissões do usuário'}
              </DialogTitle>
              <DialogDescription>
                As alterações serão registradas na auditoria da plataforma.
              </DialogDescription>
            </DialogHeader>
            {dialog?.kind === 'access' && (
              <AccessEditor
                userId={dialog.row?.id}
                platformTenantId={dialog.tenantId}
                onDone={async () => {
                  await refresh();
                  setDialog(null);
                }}
              />
            )}
            {dialog?.kind === 'invite' && (
              <SchemaForm
                schema={z.object({
                  tenant_id: z.uuid(),
                  email: emailSchema,
                  tenant_role: z.enum(['owner', 'admin', 'member', 'supervisor']),
                })}
                defaults={{ tenant_role: 'member' }}
                fields={[
                  {
                    name: 'tenant_id',
                    label: 'Empresa',
                    type: 'select',
                    options: (companies.data?.items ?? [])
                      .filter((t) => !t.suspended_at)
                      .map((t) => ({ value: t.id, label: String(t.name) })),
                  },
                  { name: 'email', label: 'E-mail', type: 'email' },
                  {
                    name: 'tenant_role',
                    label: 'Papel',
                    type: 'select',
                    options: [
                      { value: 'owner', label: 'Proprietário' },
                      { value: 'admin', label: 'Administrador' },
                      { value: 'member', label: 'Membro' },
                      { value: 'supervisor', label: 'Supervisor' },
                    ],
                  },
                ]}
                submitLabel="Enviar convite pelo SMTP global"
                onSubmit={async (b) => {
                  await api('/superadmin/invitations', {
                    method: 'POST',
                    body: { ...b, mailbox_roles: [] },
                  });
                  setDialog(null);
                  toast.success('Convite registrado para envio pelo SMTP global.');
                }}
              />
            )}
            {dialog?.kind === 'memberships' &&
              (memberships.isLoading ? (
                <LoadingState />
              ) : memberships.error ? (
                <ErrorState onRetry={() => void memberships.refetch()} />
              ) : (
                <div className="space-y-3">
                  {memberships.data?.map((m) => (
                    <div
                      key={m.tenant_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div>
                        <p className="text-sm font-semibold">{m.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {m.role} · {m.status === 'active' ? 'Ativo' : 'Desativado'}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={dialog.row?.id === me?.user.id || !!dialog.row?.platform_admin}
                        onClick={() =>
                          setDialog({ kind: 'access', row: dialog.row, tenantId: m.tenant_id })
                        }
                      >
                        Editar permissões
                      </Button>
                      <ConfirmDialog
                        title={
                          m.status === 'active'
                            ? 'Desativar acesso nesta empresa?'
                            : 'Reativar acesso nesta empresa?'
                        }
                        description="A alteração afeta somente a empresa selecionada. A empresa precisa manter um proprietário ativo."
                        trigger={
                          <Button variant="outline" size="sm">
                            {m.status === 'active' ? 'Desativar' : 'Reativar'}
                          </Button>
                        }
                        onConfirm={async () => {
                          await api('/superadmin/users/' + dialog.row?.id + '/status', {
                            method: 'PUT',
                            body: {
                              tenant_id: m.tenant_id,
                              status: m.status === 'active' ? 'disabled' : 'active',
                            },
                          });
                          await memberships.refetch();
                          await refresh();
                        }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            {dialog?.kind === 'tenant' && (
              <SchemaForm
                schema={tenantSchema.extend({ owner_email: emailSchema })}
                fields={[
                  { name: 'name', label: 'Nome da empresa' },
                  { name: 'slug', label: 'Identificador' },
                  { name: 'owner_email', label: 'E-mail do proprietário', type: 'email' },
                ]}
                onSubmit={async (b) => {
                  await api('/superadmin/tenants', { method: 'POST', body: b });
                  await refresh();
                  setDialog(null);
                  toast.success(
                    'Empresa criada. O proprietário recebe o convite pelo SMTP global quando ainda não possui conta.',
                  );
                }}
              />
            )}
            {dialog?.kind === 'credentials' && (
              <SchemaForm
                schema={z.object({ password: z.string().min(1).max(256) })}
                fields={[
                  {
                    name: 'password',
                    label: 'Nova senha de aplicativo',
                    type: 'password',
                    autoComplete: 'new-password',
                  },
                ]}
                onSubmit={async (b) => {
                  await api('/superadmin/mailboxes/' + dialog.row?.id + '/credentials', {
                    method: 'PUT',
                    body: b,
                  });
                  setDialog(null);
                  await refresh();
                  toast.success('Credencial atualizada.');
                }}
              />
            )}
            {dialog?.kind === 'mailbox' && (
              <SchemaForm
                schema={mailboxSchema.omit({ members: true }).extend({ tenant_id: z.uuid() })}
                defaults={{
                  imap_port: 993,
                  imap_secure: true,
                  smtp_port: 465,
                  smtp_secure: true,
                  sync_days: 90,
                  history_classify_days: 0,
                  aliases: [],
                  append_sent_copy: true,
                  from_name_template: '{mailbox_name}',
                }}
                fields={[
                  {
                    name: 'tenant_id',
                    label: 'Empresa',
                    type: 'select',
                    options: (companies.data?.items ?? [])
                      .filter((t) => !t.suspended_at)
                      .map((t) => ({ value: t.id, label: String(t.name) })),
                  },
                  { name: 'name', label: 'Nome da caixa' },
                  { name: 'email_address', label: 'E-mail', type: 'email' },
                  ...connectionFields,
                  {
                    name: 'sync_days',
                    label: 'Importar histórico (30, 90, 180 ou 365 dias)',
                    type: 'number',
                  },
                  {
                    name: 'history_classify_days',
                    label: 'Classificar filas dos últimos dias (0–90)',
                    type: 'number',
                    help: '0 mantém o histórico sem fila.',
                  },
                ]}
                onSubmit={async (b) => {
                  await api('/superadmin/mailboxes', { method: 'POST', body: b });
                  setDialog(null);
                  await refresh();
                  toast.success('Verificação da caixa iniciada.');
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
