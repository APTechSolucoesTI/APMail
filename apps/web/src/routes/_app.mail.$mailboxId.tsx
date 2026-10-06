import { useState, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { RefreshCw, MailOpen, Mail, FolderOpen, CheckCircle2, RotateCcw } from 'lucide-react';
import { can, QUEUE_LABELS } from '@apmail/shared';
import { toast } from 'sonner';
import type { PersonalLabel } from '@/lib/organization';
import { api } from '@/lib/api';
import { useTenantId, meQuery, type Mailbox } from '@/lib/auth';
import { mailSearchSchema } from '@/lib/search-params/mail';
import {
  folderLabel,
  flattenFolders,
  type Folder,
  type Thread,
  type ThreadDetail,
} from '@/lib/mail';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { useMediaQuery } from '@/hooks/use-media-query';
import { MailboxStatusBadge } from '@/components/common/status-badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/data/search-input';
import { ThreadLabels } from '@/components/mail/thread-labels';
import { ThreadAssignee } from '@/components/mail/thread-assignee';
import { Pagination } from '@/components/data/pagination';
import { ThreadListItem } from '@/components/mail/thread-list-item';
import { ThreadView } from '@/components/mail/thread-view';
import { MessageActions } from '@/components/mail/message-actions';
import { Composer, type ComposerHandle } from '@/components/mail/composer';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { MailboxStorageAlerts } from '@/components/storage/storage-quotas';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
export const Route = createFileRoute('/_app/mail/$mailboxId')({
  validateSearch: mailSearchSchema,
  component: MailPage,
});
function MailPage() {
  const { mailboxId } = Route.useParams(),
    search = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenantId = useTenantId(),
    desktop = useMediaQuery('(min-width: 1024px)');
  const me = useQuery(meQuery),
    client = useQueryClient(),
    box = useQuery({
      queryKey: ['mailbox', tenantId, mailboxId],
      queryFn: () => api<Mailbox>('/mailboxes/' + mailboxId),
    });
  const folders = useQuery({
    queryKey: ['folders', tenantId, mailboxId],
    queryFn: () => api<Folder[]>('/mailboxes/' + mailboxId + '/folders'),
  });
  const labels = useQuery({
    queryKey: ['labels', tenantId],
    queryFn: () => api<PersonalLabel[]>('/labels'),
    enabled: search.view === 'label',
  });
  const query = new URLSearchParams({
    view: search.view,
    assigned: search.assigned,
    sort: search.sort,
    page: String(search.page),
    page_size: String(search.pageSize),
    unread: String(search.unread ?? false),
  });
  if (search.folderId) query.set('folder_id', search.folderId);
  if (search.q) query.set('q', search.q);
  if (search.queue) query.set('queue', search.queue);
  if (search.labelId) query.set('label_id', search.labelId);
  const threads = useQuery({
    queryKey: ['threads', tenantId, mailboxId, query.toString()],
    queryFn: () =>
      api<{ items: Thread[]; total: number }>('/mailboxes/' + mailboxId + '/threads?' + query),
    placeholderData: keepPreviousData,
  });
  useSocketRoom('mailbox', mailboxId);
  const context = tenantId + mailboxId + query.toString(),
    [selection, setSelection] = useState<{ context: string; ids: string[] }>({
      context: '',
      ids: [],
    }),
    selected = selection.context === context ? selection.ids : [];
  const [updating, setUpdating] = useState(false);
  const composer = useRef<ComposerHandle>(null),
    [composerSession, setComposerSession] = useState(0),
    [pendingCompose, setPendingCompose] = useState<string | null>(null);
  const change = (patch: Partial<typeof search>) =>
    void navigate({ search: { ...search, ...patch } });
  const close = () => change({ thread: undefined });
  const clearFilters = () =>
    change({
      q: undefined,
      unread: undefined,
      assigned: 'any',
      sort: 'recent',
      view: search.view === 'search' ? 'folder' : search.view,
      page: 1,
    });
  const openComposer = (mode: string) => {
    if (search.compose) setPendingCompose(mode);
    else if (!search.compose) change({ compose: mode });
  };
  const items = threads.data?.items ?? [],
    folder = flattenFolders(folders.data ?? []).find((f) =>
      search.folderId ? f.id === search.folderId : f.special_use === 'inbox',
    );
  const mark = async (action: 'read' | 'unread' | 'done' | 'reopen') => {
    setUpdating(true);
    try {
      await api('/mailboxes/' + mailboxId + '/threads/bulk', {
        method: 'POST',
        body: { thread_ids: selected, action },
      });
      setSelection({ context, ids: [] });
      await threads.refetch();
      toast.success(
        action === 'done'
          ? 'Conversas concluídas.'
          : action === 'reopen'
            ? 'Conversas reabertas.'
            : 'Estado de leitura atualizado.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    } finally {
      setUpdating(false);
    }
  };
  const move = (direction: number) => {
    if (!items.length) return;
    const current = items.findIndex((t) => t.id === search.thread),
      next =
        current < 0
          ? direction > 0
            ? 0
            : items.length - 1
          : Math.min(items.length - 1, Math.max(0, current + direction));
    change({ thread: items[next]!.id });
  };
  const compose = (kind: string) => {
    const message = client
      .getQueryData<ThreadDetail>(['thread', tenantId, search.thread])
      ?.messages.at(-1);
    if (message && can(box.data?.role ?? null, 'send')) openComposer(kind + ':' + message.id);
  };
  useKeyboardShortcuts(
    {
      c: () => {
        if (box.data?.status === 'active' && can(box.data.role, 'send')) openComposer('new');
      },
      '/': () =>
        document
          .querySelector<HTMLInputElement>('[aria-label="Lista de conversas"] input[type="search"]')
          ?.focus(),
      j: () => move(1),
      k: () => move(-1),
      r: () => compose('reply'),
      a: () => compose('reply_all'),
      f: () => compose('forward'),
      Escape: close,
      e: () => {
        if (search.thread && !updating && can(box.data?.role ?? null, 'queue')) {
          setUpdating(true);
          void api('/threads/' + search.thread + '/done', { method: 'POST' })
            .then(() => toast.success('Conversa concluída.'))
            .catch((error: Error) => toast.error(error.message))
            .finally(() => setUpdating(false));
        }
      },
    },
    !search.compose,
  );
  if (box.isLoading) return <LoadingState />;
  if (!box.data) return <ErrorState onRetry={() => void box.refetch()} />;
  const admin = ['owner', 'admin'].includes(
    me.data?.tenants.find((t) => t.id === tenantId)?.role ?? '',
  );
  const activeFilters = [
    !!search.q,
    !!search.unread,
    search.assigned !== 'any',
    search.sort !== 'recent',
  ].filter(Boolean).length;
  const list = (
    <section aria-label="Lista de conversas" className="flex h-full min-w-0 flex-col bg-card">
      <div aria-label="Filtros da caixa" className="shrink-0 space-y-3 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <SearchInput
            className="min-w-0"
            value={search.q ?? ''}
            placeholder="Buscar assunto, remetente, conteúdo…"
            debounce={300}
            onChange={(q) =>
              change({
                q: q || undefined,
                view: q ? 'search' : search.view === 'search' ? 'folder' : search.view,
                page: 1,
              })
            }
          />
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Atualizar conversas"
            disabled={threads.isFetching}
            onClick={() => void threads.refetch()}
          >
            <RefreshCw
              className={threads.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}
            />
          </Button>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1">
            <label className="block text-xs font-medium" htmlFor="mail-assigned">
              Responsável
            </label>
            <select
              id="mail-assigned"
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
              value={search.assigned}
              onChange={(e) =>
                change({ assigned: e.target.value as typeof search.assigned, page: 1 })
              }
            >
              <option value="any">Todos</option>
              <option value="me">Minhas conversas</option>
              <option value="unassigned">Sem responsável</option>
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <label className="block text-xs font-medium" htmlFor="mail-sort">
              Ordenar
            </label>
            <select
              id="mail-sort"
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
              value={search.sort}
              onChange={(e) => change({ sort: e.target.value as typeof search.sort, page: 1 })}
            >
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
              <option value="waiting_longest">Maior espera</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-8">
            <Checkbox
              checked={
                selected.length === items.length && items.length > 0
                  ? true
                  : selected.length > 0
                    ? 'indeterminate'
                    : false
              }
              disabled={!items.length}
              aria-label="Selecionar conversas da página"
              onCheckedChange={(v) =>
                setSelection({ context, ids: v === true ? items.map((t) => t.id) : [] })
              }
            />
            Selecionar página
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-8">
            <Checkbox
              checked={!!search.unread}
              onCheckedChange={(v) => change({ unread: v === true, page: 1 })}
            />
            Não lidas
          </label>
        </div>
        {activeFilters > 0 && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Limpar filtros ({activeFilters})
            </Button>
          </div>
        )}
      </div>
      {!!selected.length && (
        <div className="space-y-2 border-b bg-muted p-3">
          <p className="text-xs font-semibold">{selected.length} selecionada(s) nesta página</p>
          <div className="flex flex-wrap items-center gap-2">
            <ThreadLabels
              mailboxId={mailboxId}
              threadIds={selected}
              onDone={() => setSelection({ context, ids: [] })}
            />
            {can(box.data.role, 'queue') && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updating}
                  onClick={() => void mark('done')}
                >
                  <CheckCircle2 />
                  Concluir
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updating}
                  onClick={() => void mark('reopen')}
                >
                  <RotateCcw />
                  Reabrir
                </Button>
                <ThreadAssignee
                  mailboxId={mailboxId}
                  threadIds={selected}
                  role={box.data.role}
                  onComplete={() => setSelection({ context, ids: [] })}
                />
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={updating}
              onClick={() => void mark('read')}
            >
              <MailOpen />
              Marcar lida
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={updating}
              onClick={() => void mark('unread')}
            >
              <Mail />
              Não lida
            </Button>
          </div>
          {can(box.data.role, 'organize') && (
            <MessageActions
              mailboxId={mailboxId}
              folders={folders.data ?? []}
              threadIds={selected}
              compact
              onDone={() => setSelection({ context, ids: [] })}
            />
          )}
        </div>
      )}
      <Pagination
        page={search.page}
        pageSize={search.pageSize}
        total={threads.data?.total ?? 0}
        onPageChange={(page) => change({ page })}
      />
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={threads.isFetching}>
        {threads.isLoading ? (
          <LoadingState />
        ) : threads.error ? (
          <ErrorState onRetry={() => void threads.refetch()} />
        ) : !items.length ? (
          <EmptyState
            title={
              search.q
                ? 'Nenhum resultado para esta busca'
                : search.unread
                  ? 'Nenhuma conversa não lida'
                  : search.view === 'queue'
                    ? 'Nenhuma conversa nesta fila'
                    : 'Esta pasta está vazia.'
            }
            description={
              search.view === 'label'
                ? 'Aplique esta etiqueta nas conversas que deseja organizar.'
                : search.view === 'queue'
                  ? 'As conversas aparecerão aqui conforme o atendimento.'
                  : search.q
                    ? 'Tente outro termo ou ajuste os filtros.'
                    : 'As mensagens desta pasta aparecerão após a sincronização.'
            }
            action={
              search.q || search.unread || search.assigned !== 'any' ? (
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          items.map((t) => (
            <ThreadListItem
              key={t.id}
              thread={t}
              query={search.q}
              selected={selected.includes(t.id)}
              active={search.thread === t.id}
              onSelect={(v) =>
                setSelection({
                  context,
                  ids: v ? [...selected, t.id] : selected.filter((id) => id !== t.id),
                })
              }
              onOpen={() => change({ thread: t.id })}
            />
          ))
        )}
      </div>
      <Pagination
        page={search.page}
        pageSize={search.pageSize}
        total={threads.data?.total ?? 0}
        onPageChange={(page) => change({ page })}
      />
    </section>
  );
  const reading = search.thread ? (
    <ThreadView
      key={search.thread}
      threadId={search.thread}
      mailboxId={mailboxId}
      folders={folders.data ?? []}
      onClose={close}
      onCompose={openComposer}
    />
  ) : (
    <EmptyState
      icon={FolderOpen}
      title="Selecione uma conversa"
      description="Escolha um e-mail na lista para ver as mensagens e os anexos."
    />
  );
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{box.data.name}</h1>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {search.view === 'search'
              ? 'Resultados da busca'
              : search.view === 'label'
                ? 'Etiqueta: ' +
                  (labels.data?.find((l) => l.id === search.labelId)?.name ?? 'Carregando…')
                : search.view === 'queue'
                  ? search.queue === 'overdue'
                    ? 'Fora do SLA'
                    : QUEUE_LABELS[search.queue ?? 'to_reply']
                  : folder
                    ? folderLabel(folder)
                    : 'Caixa de entrada'}{' '}
            · <span className="font-mono">{box.data.email_address}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MailboxStatusBadge status={box.data.status} />
          {can(box.data.role, 'send') && (
            <Button disabled={box.data.status !== 'active'} onClick={() => openComposer('new')}>
              Novo e-mail
            </Button>
          )}
        </div>
      </header>
      <MailboxStorageAlerts key={mailboxId} mailboxId={mailboxId} />
      {box.data.status === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger-fg"
        >
          <p>
            Não foi possível sincronizar esta caixa:{' '}
            {box.data.last_error ?? 'Peça ao administrador para verificar a conexão.'}
          </p>
          {admin && (
            <Button
              variant="outline"
              disabled={updating}
              onClick={async () => {
                setUpdating(true);
                try {
                  await api('/mailboxes/' + mailboxId + '/reconnect', { method: 'POST' });
                  await box.refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Falha ao reconectar.');
                } finally {
                  setUpdating(false);
                }
              }}
            >
              Reconectar
            </Button>
          )}
        </div>
      )}
      {box.data.status === 'pending' && (
        <p role="status" className="text-sm text-muted-foreground">
          Verificando conexão… A importação começará após a confirmação.
        </p>
      )}
      {box.data.status === 'disabled' && (
        <p role="status" className="text-sm text-muted-foreground">
          Esta caixa está desativada.
        </p>
      )}
      <div className="h-[calc(100dvh-13rem)] min-h-96 overflow-hidden rounded-lg border bg-card">
        {desktop ? (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="40%" minSize="30%" maxSize="55%">
              {list}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel>{reading}</ResizablePanel>
          </ResizablePanelGroup>
        ) : search.thread ? (
          reading
        ) : (
          list
        )}
      </div>
      {search.compose && can(box.data.role, 'send') && (
        <Composer
          key={mailboxId + ':' + composerSession}
          ref={composer}
          mailboxId={mailboxId}
          mode={search.compose}
          threadId={search.thread}
          onClose={() => change({ compose: undefined })}
          onReopen={(id) => change({ compose: 'draft:' + id })}
        />
      )}
      <ConfirmDialog
        open={!!pendingCompose}
        onOpenChange={(open) => {
          if (!open) setPendingCompose(null);
        }}
        title="Abrir outro e-mail?"
        description="O e-mail atual será salvo como rascunho antes de abrir o próximo."
        onConfirm={async () => {
          await composer.current?.saveDraft();
          setComposerSession((n) => n + 1);
          change({ compose: pendingCompose ?? undefined });
          setPendingCompose(null);
        }}
      />
    </div>
  );
}
