import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Layers, RefreshCw } from 'lucide-react';
import { QUEUE_LABELS } from '@apmail/shared';
import { MAIL_BULK_LIMIT, useMailPages } from '@/hooks/use-mail-pages';
import { toast } from 'sonner';
import { MailPageContinuation } from '@/components/mail/mail-page-continuation';
import { meQuery, useMailQueues, useTenantId, type Mailbox } from '@/lib/auth';
import { api } from '@/lib/api';
import { mailSearchSchema } from '@/lib/search-params/mail';
import type { Thread } from '@/lib/mail';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/data/search-input';
import { Pagination } from '@/components/data/pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';
import { MailSelectionActions } from '@/components/mail/mail-selection-actions';
import { MailContextMenu } from '@/components/mail/mail-context-menu';
import { AssigneeFilter } from '@/components/mail/assignee-filter';
import { ThreadListItem } from '@/components/mail/thread-list-item';

export const Route = createFileRoute('/_app/mail-summary')({
  validateSearch: mailSearchSchema,
  component: SummaryPage,
});
export function SummaryPage() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenant = useTenantId();
  const me = useQuery(meQuery),
    queues = useMailQueues(search.mailboxId);
  const mailboxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
    enabled: !!tenant && !!me.data?.preferences.mail_summary_enabled,
  });
  const pageSize = search.pageSize ?? me.data?.preferences.mail_page_size ?? 50;
  const view = search.view === 'queue' && queues ? 'queue' : search.q ? 'search' : 'folder';
  const query = new URLSearchParams({
    view,
    page: String(search.page),
    page_size: String(pageSize),
    sort: search.sort,
    assigned: search.assigned ?? 'any',
    unread: String(!!search.unread),
  });
  if (search.q) query.set('q', search.q);
  if (search.mailboxId) query.set('mailbox_id', search.mailboxId);
  if (search.status) query.set('status', search.status);
  if (search.from) query.set('from', search.from);
  if (search.until) query.set('until', search.until);
  if (search.queue && view === 'queue') query.set('queue', search.queue);
  const result = useMailPages<Thread>({
    path: '/mail-summary/threads',
    key: ['threads', tenant, 'summary'],
    params: query,
    page: search.page,
    size: pageSize,
    refetchInterval: 30000,
    enabled: !!me.data?.preferences.mail_summary_enabled,
  });
  const [selected, setSelected] = useState<{ context: string; ids: string[] }>({
    context: '',
    ids: [],
  });
  const context = tenant + query.toString();
  const ids = selected.context === context ? selected.ids : [];
  const items = useMemo(() => result.data?.items ?? [], [result.data]);
  const change = (patch: Partial<typeof search>) =>
    void navigate({ search: { ...search, ...patch } });
  useEffect(() => {
    if (!result.data || result.isFetching || result.isPlaceholderData) return;
    const last = pageSize === 0 ? 1 : Math.max(1, Math.ceil(result.data.total / pageSize));
    if (search.page > last) void navigate({ search: { ...search, page: last }, replace: true });
  }, [result.data, result.isFetching, result.isPlaceholderData, pageSize, search, navigate]);
  if (me.data && !me.data.preferences.mail_summary_enabled)
    return <Navigate to="/settings/preferences" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Layers className="size-6 text-primary" />
          Resumo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {view === 'queue'
            ? search.queue === 'overdue'
              ? 'Fora do SLA'
              : QUEUE_LABELS[search.queue ?? 'to_reply']
            : 'Caixas de entrada'}{' '}
          · Todas as caixas às quais você tem acesso
        </p>
      </header>
      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card"
        aria-label="Resumo das caixas"
      >
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <SearchInput
            value={search.q ?? ''}
            placeholder="Buscar texto ou data…"
            debounce={350}
            onChange={(q) => change({ q: q || undefined, page: 1 })}
          />
          <label className="space-y-1 text-xs">
            Ordenar
            <select
              className="block h-11 rounded-md border bg-card px-2 sm:h-8"
              value={search.sort}
              onChange={(e) => change({ sort: e.target.value as typeof search.sort, page: 1 })}
            >
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
              {queues && <option value="waiting_longest">Maior espera</option>}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Caixa
            <select
              aria-label="Filtrar caixa"
              className="block h-11 max-w-64 rounded-md border bg-card px-2 sm:h-8"
              value={search.mailboxId ?? ''}
              onChange={(e) => change({ mailboxId: e.target.value || undefined, page: 1 })}
            >
              <option value="">Todas as caixas</option>
              {mailboxes.data?.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name} ({box.email_address})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Status
            <select
              aria-label="Filtrar status"
              className="block h-11 rounded-md border bg-card px-2 sm:h-8"
              value={search.status ?? ''}
              onChange={(e) =>
                change({ status: (e.target.value as typeof search.status) || undefined, page: 1 })
              }
            >
              <option value="">Todos os status</option>
              {(
                ['none', 'to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done'] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {QUEUE_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <AssigneeFilter
            mailboxes={(mailboxes.data ?? []).filter(
              (box) => !search.mailboxId || box.id === search.mailboxId,
            )}
            value={search.assigned}
            onChange={(assigned) => change({ assigned, page: 1 })}
            id="summary-assigned"
          />
          <label className="space-y-1 text-xs">
            De
            <input
              type="date"
              className="block h-11 rounded-md border bg-card px-2 sm:h-8"
              value={search.from ?? ''}
              max={search.until}
              onChange={(e) => change({ from: e.target.value || undefined, page: 1 })}
            />
          </label>
          <label className="space-y-1 text-xs">
            Até
            <input
              type="date"
              className="block h-11 rounded-md border bg-card px-2 sm:h-8"
              value={search.until ?? ''}
              min={search.from}
              onChange={(e) => change({ until: e.target.value || undefined, page: 1 })}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-8">
            <Checkbox
              checked={!!search.unread}
              onCheckedChange={(value) => change({ unread: value === true, page: 1 })}
            />
            Não lidas
          </label>
          <Button
            variant="outline"
            size="icon"
            aria-label="Atualizar Resumo"
            disabled={result.isFetching}
            onClick={() => void result.refetch()}
          >
            <RefreshCw
              className={result.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}
            />
          </Button>
          {(search.q ||
            search.unread ||
            (search.assigned && search.assigned !== 'any') ||
            search.sort !== 'recent' ||
            search.mailboxId ||
            search.status ||
            search.from ||
            search.until) && (
            <Button
              variant="ghost"
              onClick={() =>
                change({
                  q: undefined,
                  unread: false,
                  assigned: 'any',
                  sort: 'recent',
                  mailboxId: undefined,
                  status: undefined,
                  from: undefined,
                  until: undefined,
                  page: 1,
                })
              }
            >
              Limpar filtros
            </Button>
          )}
        </div>
        {!!ids.length && (
          <MailSelectionActions
            threads={items.filter((thread) => ids.includes(thread.id))}
            onProcessed={(done) =>
              setSelected((previous) => ({
                ...previous,
                ids: previous.ids.filter((id) => !done.includes(id)),
              }))
            }
          />
        )}
        <Pagination
          page={search.page}
          pageSize={pageSize}
          total={result.data?.total ?? 0}
          onPageChange={(page) => change({ page })}
        />
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={result.isFetching}>
          {result.isPending ? (
            <LoadingState />
          ) : result.error && !result.isFetchNextPageError ? (
            <ErrorState onRetry={() => void result.refetch()} />
          ) : !items.length ? (
            <EmptyState
              title="Nenhuma conversa neste filtro"
              description="Ajuste os filtros ou aguarde novas mensagens nas caixas acessíveis."
            />
          ) : (
            items.map((thread) => {
              const mailboxId = thread.mailbox_id!;
              const open = () =>
                void navigate({
                  to: '/mail/$mailboxId',
                  params: { mailboxId },
                  search: { view: 'search', thread: thread.id, fromSummary: true },
                });
              return (
                <MailContextMenu
                  key={thread.id}
                  thread={thread}
                  mailboxId={mailboxId}
                  onOpen={open}
                  onCompose={(compose) =>
                    void navigate({
                      to: '/mail/$mailboxId',
                      params: { mailboxId },
                      search: { compose, composeThread: thread.id, fromSummary: true },
                    })
                  }
                >
                  <ThreadListItem
                    thread={thread}
                    mailbox={mailboxes.data?.find((box) => box.id === mailboxId)}
                    showMailbox
                    contacts={result.data?.contacts}
                    query={search.q}
                    active={false}
                    selected={ids.includes(thread.id)}
                    onSelect={(value) => {
                      if (value && ids.length >= MAIL_BULK_LIMIT) {
                        toast.info('Selecione até 100 e-mails por operação.');
                        return;
                      }
                      setSelected({
                        context,
                        ids: value ? [...ids, thread.id] : ids.filter((id) => id !== thread.id),
                      });
                    }}
                    onOpen={open}
                  />
                </MailContextMenu>
              );
            })
          )}
          <MailPageContinuation {...result} />
        </div>
        <Pagination
          page={search.page}
          pageSize={pageSize}
          total={result.data?.total ?? 0}
          onPageChange={(page) => change({ page })}
        />
      </section>
    </div>
  );
}
