import { useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  dashboardSearchSchema,
  type DashboardKpis,
  type DailyVolume,
  type FolderVolume,
  type DashboardQueue,
  type UserProductivity,
  type StaleThread,
} from '@apmail/shared';
import {
  AlarmClock,
  Inbox,
  Send,
  UserCheck,
  Hourglass,
  Timer,
  Users,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { meQuery, useTenantId, canMailbox, type Mailbox } from '@/lib/auth';
import { dashboardDates, durationLabel } from '@/lib/dashboard';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LoadingState,
  ErrorState,
  EmptyState,
  NoPermissionState,
} from '@/components/data/data-state';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { VolumeChart, FolderChart, QueueChart } from '@/components/dashboard/charts';
import { UserTable, StaleThreadsTable } from '@/components/dashboard/tables';
export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: dashboardSearchSchema,
  component: Dashboard,
});
function useDashboardData<T>(endpoint: string, params: string, enabled: boolean) {
  const tenantId = useTenantId();
  const me = useQuery(meQuery);
  const tenant = me.data?.tenants.find((item) => item.id === tenantId);
  const accessKey = [me.data?.user.id, tenant?.role];
  return useQuery({
    queryKey: ['dashboard', tenantId, endpoint, params, accessKey],
    queryFn: ({ signal }) => api<T>('/dashboard/' + endpoint + '?' + params, { signal }),
    enabled,
    placeholderData: (previous, query) =>
      JSON.stringify(query?.queryKey[4]) === JSON.stringify(accessKey)
        ? keepPreviousData(previous)
        : undefined,
    refetchInterval: 60000,
  });
}
function ChartBlock({
  title,
  description,
  children,
  isLoading,
  error,
  onRetry,
  empty,
}: {
  title: string;
  description: string;
  children: ReactNode;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card p-4 shadow-card">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{description}</p>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : empty ? (
        <EmptyState
          title="Sem dados no período"
          description="Ajuste o período ou escolha outra caixa."
        />
      ) : (
        children
      )}
    </section>
  );
}
function CustomPeriod({
  dates,
  onApply,
}: {
  dates: { from: string; to: string };
  onApply: (dates: { from: string; to: string }) => void;
}) {
  const [custom, setCustom] = useState(dates);
  return (
    <form
      key={dates.from + dates.to}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(custom);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="dashboard-from">De</Label>
        <Input
          id="dashboard-from"
          type="date"
          required
          value={custom.from}
          max={custom.to}
          onChange={(event) => setCustom({ ...custom, from: event.target.value })}
          className="min-h-11"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dashboard-to">Até</Label>
        <Input
          id="dashboard-to"
          type="date"
          required
          value={custom.to}
          min={custom.from}
          max={
            custom.from
              ? new Date(new Date(custom.from + 'T12:00:00Z').getTime() + 365 * 86400000)
                  .toISOString()
                  .slice(0, 10)
              : undefined
          }
          onChange={(event) => setCustom({ ...custom, to: event.target.value })}
          className="min-h-11"
        />
      </div>
      <Button variant="outline" type="submit" className="min-h-11">
        Aplicar período
      </Button>
    </form>
  );
}
function Dashboard() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenantId = useTenantId(),
    me = useQuery(meQuery);
  const boxes = useQuery({
    queryKey: ['mailboxes', tenantId],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const tenant = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => api<{ timezone: string }>('/tenant'),
  });
  const allowedBoxes = (boxes.data ?? []).filter((box) => canMailbox(box, 'read'));
  const tenantRole = me.data?.tenants.find((t) => t.id === tenantId)?.role;
  const personal = tenantRole === 'member';
  const allowed = !!me.data && !!tenantRole;
  const dates = dashboardDates(
    search.period,
    tenant.data?.timezone ?? 'America/Sao_Paulo',
    search.from,
    search.to,
  );
  const valid =
    dates.from <= dates.to &&
    (new Date(dates.to).getTime() - new Date(dates.from).getTime()) / 86400000 <= 365;
  const enabled = !!boxes.data && !!tenant.data && allowed && valid;
  const params = new URLSearchParams({
    ...dates,
    ...(search.mailboxId ? { mailbox_id: search.mailboxId } : {}),
    ...(!personal && search.userId ? { user_id: search.userId } : {}),
  }).toString();
  const kpis = useDashboardData<DashboardKpis>('kpis', params, enabled),
    volume = useDashboardData<DailyVolume[]>('daily-volume', params, enabled),
    folders = useDashboardData<FolderVolume[]>('by-folder', params, enabled),
    queues = useDashboardData<DashboardQueue[]>('queue-counts', params, enabled),
    users = useDashboardData<UserProductivity[]>('by-user', params, enabled),
    stale = useDashboardData<StaleThread[]>('stale-threads', params, enabled);
  const directoryParams = new URLSearchParams({
    ...dates,
    ...(search.mailboxId ? { mailbox_id: search.mailboxId } : {}),
  }).toString();
  const directory = useDashboardData<UserProductivity[]>(
    'by-user',
    directoryParams,
    enabled && !personal,
  );
  const all = [kpis, volume, folders, queues, users, stale],
    updating = all.some((q) => q.isFetching);
  const selected = search.mailboxId
    ? allowedBoxes.filter((b) => b.id === search.mailboxId)
    : allowedBoxes;
  const change = (next: Partial<typeof search>) =>
    void navigate({ search: { ...search, ...next } });
  if (boxes.isLoading || tenant.isLoading || me.isLoading)
    return (
      <>
        <PageHeader title="Dashboard" />
        <LoadingState />
      </>
    );
  if (boxes.error || tenant.error)
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState
          onRetry={() => {
            void boxes.refetch();
            void tenant.refetch();
          }}
        />
      </>
    );
  if (
    !allowed ||
    all.some((q) => q.error instanceof ApiError && [403, 404].includes(q.error.status))
  )
    return (
      <>
        <PageHeader title="Dashboard" />
        <NoPermissionState />
      </>
    );
  const values = kpis.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          personal
            ? 'Seus envios e atendimentos atribuídos, nas caixas e pastas que você pode acessar.'
            : 'Volume, produtividade e prioridades nas caixas e pastas permitidas.'
        }
      />
      <section
        aria-label="Filtros do dashboard"
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      >
        <div className="space-y-1">
          <Label htmlFor="dashboard-period">Período</Label>
          <Select
            value={search.period}
            onValueChange={(value) => {
              const period = dashboardSearchSchema.shape.period.parse(value);
              const next = dashboardDates(period, tenant.data!.timezone);
              change({ period, ...next });
            }}
          >
            <SelectTrigger id="dashboard-period" className="min-h-11 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="dashboard-mailbox">Caixa</Label>
          <Select
            value={search.mailboxId ?? 'all'}
            onValueChange={(id) =>
              change({ mailboxId: id === 'all' ? undefined : id, userId: undefined })
            }
          >
            <SelectTrigger id="dashboard-mailbox" className="min-h-11 w-64 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as caixas permitidas</SelectItem>
              {allowedBoxes.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!personal && (
          <div className="space-y-1">
            <Label htmlFor="dashboard-user">Usuário</Label>
            <Select
              value={search.userId ?? 'all'}
              disabled={directory.isLoading || !!directory.error}
              onValueChange={(id) => change({ userId: id === 'all' ? undefined : id })}
            >
              <SelectTrigger id="dashboard-user" className="min-h-11 w-64 max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usuários permitidos</SelectItem>
                {directory.data?.map((user) => (
                  <SelectItem key={user.user_id} value={user.user_id}>
                    {user.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {directory.error && (
              <Button variant="outline" onClick={() => void directory.refetch()}>
                Recarregar usuários
              </Button>
            )}
          </div>
        )}
        {search.period === 'custom' && (
          <CustomPeriod key={dates.from + dates.to} dates={dates} onApply={change} />
        )}
        <Button
          variant="outline"
          className="min-h-11"
          disabled={updating || !valid}
          onClick={() => all.forEach((q) => void q.refetch())}
        >
          <RefreshCw className="size-4" aria-hidden />
          Atualizar
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          {dates.from.split('-').reverse().join('/')}–{dates.to.split('-').reverse().join('/')} ·{' '}
          {tenant.data?.timezone}
        </p>
        {updating && (
          <p role="status" className="text-xs text-muted-foreground">
            Atualizando dados…
          </p>
        )}
        {!valid && (
          <p role="alert" className="text-sm text-danger-fg">
            Escolha um intervalo válido de até 366 dias.
          </p>
        )}
      </section>
      {valid && (
        <>
          <section aria-label="Indicadores principais">
            {kpis.isLoading ? (
              <LoadingState />
            ) : kpis.error ? (
              <ErrorState onRetry={() => void kpis.refetch()} />
            ) : (
              values && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Recebidos"
                    value={values.received}
                    detail="No período · sem automáticos ou spam"
                    icon={Inbox}
                    boxes={selected}
                  />
                  <KpiCard
                    label="Enviados"
                    value={values.sent}
                    detail={`${values.sent_via_apmail} via APMail · no período`}
                    icon={Send}
                    boxes={selected}
                  />
                  <KpiCard
                    label="A responder"
                    value={values.to_reply}
                    icon={Inbox}
                    queue="to_reply"
                    boxes={selected}
                  />
                  <KpiCard
                    label="Em atendimento"
                    value={values.in_progress}
                    icon={UserCheck}
                    queue="in_progress"
                    boxes={selected}
                  />
                  <KpiCard
                    label="Aguardando resposta"
                    value={values.awaiting_reply}
                    icon={Hourglass}
                    queue="awaiting_reply"
                    boxes={selected}
                  />
                  <KpiCard
                    label="Fora do SLA"
                    value={values.overdue}
                    icon={AlarmClock}
                    danger={values.overdue > 0}
                    queue="overdue"
                    boxes={selected}
                  />
                  <KpiCard
                    label="Tempo médio de 1ª resposta"
                    value={durationLabel(values.avg_first_response_minutes)}
                    detail={`${values.response_rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% das conversas respondidas`}
                    icon={Timer}
                    boxes={selected}
                  />
                  <KpiCard
                    label="Usuários ativos"
                    value={values.active_users}
                    detail="Equipe com acesso ao escopo"
                    icon={Users}
                    boxes={selected}
                  />
                </div>
              )
            )}
          </section>
          <ChartBlock
            title="Volume diário"
            description="Mensagens recebidas e enviadas no período."
            isLoading={volume.isLoading}
            error={volume.error}
            onRetry={() => void volume.refetch()}
            empty={!volume.data?.some((d) => d.received || d.sent)}
          >
            <VolumeChart data={volume.data ?? []} />
          </ChartBlock>
          <div className="grid gap-6 xl:grid-cols-2">
            <ChartBlock
              title="Por pasta"
              description="As dez pastas com mais mensagens recebidas no período."
              isLoading={folders.isLoading}
              error={folders.error}
              onRetry={() => void folders.refetch()}
              empty={!folders.data?.length}
            >
              <FolderChart data={folders.data ?? []} />
            </ChartBlock>
            <ChartBlock
              title="Filas"
              description="Conversas por estado atual, incluindo todos os agendamentos."
              isLoading={queues.isLoading}
              error={queues.error}
              onRetry={() => void queues.refetch()}
              empty={!queues.data?.some((q) => q.count)}
            >
              <QueueChart data={queues.data ?? []} />
            </ChartBlock>
          </div>
          <section className="min-w-0 space-y-3">
            <h2 className="text-xl font-semibold">Produtividade por usuário</h2>
            <p className="text-xs text-muted-foreground">
              Envios e conclusões no período; atribuições em aberto mostram o estado atual.
            </p>
            <UserTable
              key={params}
              data={users.data}
              isLoading={users.isLoading}
              isFetching={users.isFetching}
              error={users.error}
              onRetry={() => void users.refetch()}
              {...dates}
            />
          </section>
          <section className="min-w-0 space-y-3">
            <h2 className="text-xl font-semibold">Conversas paradas há mais tempo</h2>
            <p className="text-xs text-muted-foreground">
              As 20 conversas em aberto com espera mais longa nas caixas escolhidas.
            </p>
            <StaleThreadsTable
              key={params}
              data={stale.data}
              isLoading={stale.isLoading}
              isFetching={stale.isFetching}
              error={stale.error}
              onRetry={() => void stale.refetch()}
            />
          </section>
        </>
      )}
    </div>
  );
}
