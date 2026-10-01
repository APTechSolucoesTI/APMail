import { useState } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { Mail, Sun, Moon, Monitor, Eye } from 'lucide-react';
import { listQuerySchema, type ListQuery, type QueueStatus } from '@apmail/shared';
import { ConfigurableTable, type ListColumn } from '@/components/data/configurable-table';
import { PageHeader } from '@/components/layout/page-header';
import { useTheme } from '@/components/layout/theme-provider';
import {
  LoadingState,
  EmptyState,
  ErrorState,
  NoPermissionState,
  NoResultsState,
} from '@/components/data/data-state';
import {
  QueueStatusBadge,
  MailboxStatusBadge,
  OutboxStatusBadge,
  RoleBadge,
} from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { FoundationGallery } from '@/components/common/foundation-gallery';
export const Route = createFileRoute('/_dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  validateSearch: (search) => listQuerySchema.parse(search),
  component: Showcase,
});
type Demo = { id: string; name: string; email: string; status: string; amount: number };
const rows: Demo[] = Array.from({ length: 35 }, (_, index) => ({
  id: String(index + 1),
  name: `Pessoa ${index + 1}`,
  email: `pessoa${index + 1}@exemplo.local`,
  status: index % 3 === 0 ? 'pending' : 'active',
  amount: (index + 1) * 10,
}));
const columns: ListColumn<Demo>[] = [
  { id: 'name', header: 'Nome', hideable: false, sortable: true },
  { id: 'email', header: 'E-mail', sortable: true },
  {
    id: 'status',
    header: 'Status',
    sortable: true,
    cell: (row) => <MailboxStatusBadge status={row.status as 'active' | 'pending'} />,
  },
  { id: 'amount', header: 'Volume', sortable: true, align: 'right' },
];
function Showcase() {
  const query = Route.useSearch();
  const navigate = Route.useNavigate();
  const { theme, setTheme } = useTheme();
  const [state, setState] = useState('ready');
  const update = (next: ListQuery) => {
    void navigate({ search: next });
  };
  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="Componentes da interface"
        description="Fundação visual e estados operacionais do APMail."
        actions={
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((value) => {
              const Icon = value === 'light' ? Sun : value === 'dark' ? Moon : Monitor;
              return (
                <Button
                  key={value}
                  variant={theme === value ? 'default' : 'outline'}
                  size="icon"
                  aria-label={`Tema ${value === 'light' ? 'claro' : value === 'dark' ? 'escuro' : 'do sistema'}`}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <Icon />
                </Button>
              );
            })}
          </div>
        }
      />
      <section className="mb-6 space-y-4 rounded-lg border bg-card p-4 shadow-card">
        <h2 className="text-2xl font-semibold">Estados e identidade</h2>
        <div className="flex flex-wrap gap-2">
          {(
            ['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done'] as QueueStatus[]
          ).map((status) => (
            <QueueStatusBadge key={status} status={status} />
          ))}
          <OutboxStatusBadge status="failed" />
          <RoleBadge role="owner" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UserAvatar name="Henrique Rufino" online />
          <Button onClick={() => toast.success('Alterações salvas.')}>Ação principal</Button>
          <Button variant="outline">Ação secundária</Button>
          <Button variant="destructive">Ação destrutiva</Button>
          <Button disabled>Indisponível</Button>
        </div>
      </section>
      <section className="mb-6">
        <h2 className="mb-3 text-2xl font-semibold">Listagem configurável</h2>
        <label className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          Estado da listagem
          <select
            className="h-11 rounded-md border border-input bg-card px-3"
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="ready">Dados disponíveis</option>
            <option value="loading">Carregando</option>
            <option value="fetching">Atualizando</option>
            <option value="empty">Vazio</option>
            <option value="error">Erro</option>
          </select>
        </label>
        <ConfigurableTable
          listKey="dev-showcase"
          columns={columns}
          data={state === 'empty' ? [] : rows}
          query={query}
          onQueryChange={update}
          mode="client"
          selectable
          filters={[
            {
              id: 'status',
              label: 'Status',
              options: [
                { value: 'active', label: 'Ativa' },
                { value: 'pending', label: 'Verificando' },
              ],
            },
          ]}
          isLoading={state === 'loading'}
          isFetching={state === 'fetching'}
          error={state === 'error' ? new Error() : null}
          onRetry={() => setState('ready')}
          bulkActions={(ids) => (
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info(`${ids.length} registros selecionados nesta página.`)}
            >
              Conferir seleção
            </Button>
          )}
          rowActions={(row) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Visualizar ${row.name}`}
                  onClick={() => toast.info(row.email)}
                >
                  <Eye />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Visualizar {row.name}</TooltipContent>
            </Tooltip>
          )}
        />
      </section>
      <FoundationGallery />
      <section>
        <h2 className="mb-3 text-2xl font-semibold">Estados de dados</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-card">
            <LoadingState />
          </div>
          <div className="rounded-lg border bg-card">
            <EmptyState
              icon={Mail}
              title="Nenhuma conversa"
              description="As mensagens recebidas aparecerão aqui."
            />
          </div>
          <div className="rounded-lg border bg-card">
            <ErrorState onRetry={() => toast.info('Tentando novamente…')} />
          </div>
          <div className="rounded-lg border bg-card">
            <NoPermissionState />
          </div>
          <div className="rounded-lg border bg-card">
            <NoResultsState onClear={() => toast.info('Filtros limpos.')} />
          </div>
        </div>
      </section>
    </main>
  );
}
