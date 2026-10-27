import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Layers, RefreshCw } from 'lucide-react';
import { QUEUE_LABELS, type ContactResolution } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useMailQueues, useTenantId } from '@/lib/auth';
import { mailSearchSchema } from '@/lib/search-params/mail';
import type { Thread } from '@/lib/mail';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/data/search-input';
import { Pagination } from '@/components/data/pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';
import { ThreadListItem } from '@/components/mail/thread-list-item';

export const Route = createFileRoute('/_app/mail-summary')({
  validateSearch: mailSearchSchema,
  component: SummaryPage,
});
function SummaryPage() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenant = useTenantId();
  const me = useQuery(meQuery),
    queues = useMailQueues();
  const pageSize = search.pageSize ?? me.data?.preferences.mail_page_size ?? 10;
  const view = search.view === 'queue' && queues ? 'queue' : search.q ? 'search' : 'folder';
  const query = new URLSearchParams({
    view,
    page: String(search.page),
    page_size: String(pageSize),
    sort: search.sort,
    assigned: queues ? search.assigned : 'any',
    unread: String(!!search.unread),
  });
  if (search.q) query.set('q', search.q);
  if (search.queue && view === 'queue') query.set('queue', search.queue);
  const result = useQuery({
    queryKey: ['threads', tenant, 'summary', query.toString()],
    queryFn: () =>
      api<{ items: Thread[]; total: number; contacts?: ContactResolution }>(
        '/mail-summary/threads?' + query,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
    enabled: !!me.data?.preferences.mail_summary_enabled,
  });
  const [selected, setSelected] = useState<{ context: string; ids: string[] }>({
      context: '',
      ids: [],
    }),
    [busy, setBusy] = useState(false);
  const context = tenant + query.toString();
  const ids = selected.context === context ? selected.ids : [];
  const items = useMemo(() => result.data?.items ?? [], [result.data]);
  const change = (patch: Partial<typeof search>) =>
    void navigate({ search: { ...search, ...patch } });
  useEffect(() => {
    if (!result.data || result.isFetching || result.isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(result.data.total / pageSize));
    if (search.page > last) void navigate({ search: { ...search, page: last }, replace: true });
  }, [result.data, result.isFetching, result.isPlaceholderData, pageSize, search, navigate]);
  if (me.data && !me.data.preferences.mail_summary_enabled)
    return <Navigate to="/settings/preferences" />;
  const mark = async (action: 'read' | 'unread' | 'done') => {
    setBusy(true);
    try {
      const groups = new Map<string, string[]>();
      for (const item of items.filter((t) => ids.includes(t.id)))
        if (item.mailbox_id)
          groups.set(item.mailbox_id, [...(groups.get(item.mailbox_id) ?? []), item.id]);
      for (const [box, thread_ids] of groups)
        await api('/mailboxes/' + box + '/threads/bulk', {
          method: 'POST',
          body: { thread_ids, action },
        });
      setSelected({ context, ids: [] });
      await result.refetch();
      toast.success('Conversas atualizadas.');
    } catch (e) {
      toast.error((e as Error).message);
      await result.refetch();
    } finally {
      setBusy(false);
    }
  };
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
            placeholder="Buscar assunto, remetente, conteúdo…"
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
          {queues && (
            <label className="space-y-1 text-xs">
              Responsável
              <select
                className="block h-11 rounded-md border bg-card px-2 sm:h-8"
                value={search.assigned}
                onChange={(e) =>
                  change({ assigned: e.target.value as typeof search.assigned, page: 1 })
                }
              >
                <option value="any">Todos</option>
                <option value="me">Minhas conversas</option>
                <option value="unassigned">Sem responsável</option>
              </select>
            </label>
          )}
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
          {(search.q || search.unread || search.assigned !== 'any' || search.sort !== 'recent') && (
            <Button
              variant="ghost"
              onClick={() =>
                change({ q: undefined, unread: false, assigned: 'any', sort: 'recent', page: 1 })
              }
            >
              Limpar filtros
            </Button>
          )}
        </div>
        {!!ids.length && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted p-3">
            <span className="text-xs">{ids.length} selecionada(s) nesta página</span>
            {(
              ['read', 'unread', ...(queues ? ['done'] : [])] as ('read' | 'unread' | 'done')[]
            ).map((action) => (
              <Button
                key={action}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void mark(action)}
              >
                {action === 'read' ? 'Marcar lida' : action === 'unread' ? 'Não lida' : 'Concluir'}
              </Button>
            ))}
          </div>
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
          ) : result.error ? (
            <ErrorState onRetry={() => void result.refetch()} />
          ) : !items.length ? (
            <EmptyState
              title="Nenhuma conversa neste filtro"
              description="Ajuste os filtros ou aguarde novas mensagens nas caixas acessíveis."
            />
          ) : (
            items.map((thread) => (
              <ThreadListItem
                key={thread.id}
                thread={thread}
                showMailbox
                contacts={result.data?.contacts}
                query={search.q}
                active={false}
                selected={ids.includes(thread.id)}
                onSelect={(value) =>
                  setSelected({
                    context,
                    ids: value ? [...ids, thread.id] : ids.filter((id) => id !== thread.id),
                  })
                }
                onOpen={() =>
                  void navigate({
                    to: '/mail/$mailboxId',
                    params: { mailboxId: thread.mailbox_id! },
                    search: { view: 'search', thread: thread.id, fromSummary: true },
                  })
                }
              />
            ))
          )}
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
