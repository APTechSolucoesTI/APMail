import { ConfigurableTable } from '@/components/data/configurable-table';
import { LabelBadge } from '@/components/mail/label-badge';
import { QueueStatusBadge } from '@/components/common/status-badge';
import { useState, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { RefreshCw, MailOpen, Mail, FolderOpen, CheckCircle2, RotateCcw } from 'lucide-react';
import { can, QUEUE_LABELS } from '@apmail/shared';
import { toast } from 'sonner';
import type { PersonalLabel } from '@/lib/organization';
import { api } from '@/lib/api';
import { useTenantId, meQuery, canMailbox, type Mailbox } from '@/lib/auth';
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
    queryKey: ['labels', tenantId, me.data?.user.id, mailboxId],
    queryFn: () => api<PersonalLabel[]>('/labels?mailbox_id=' + mailboxId),
    enabled: search.view === 'label',
  });
  const query = new URLSearchParams({
    columns: JSON.stringify(
      Object.fromEntries(
        Object.entries(search.columns)
          .filter(([key]) => key.startsWith('column:'))
          .map(([key, v]) => [key.slice(7), v]),
      ),
    ),
    ...(search.columnSort
      ? { column_sort: search.columnSort.key, column_direction: search.columnSort.direction }
      : {}),
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
      columns: {},
      columnSort: undefined,
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
    if (message && box.data && canMailbox(box.data, 'send')) openComposer(kind + ':' + message.id);
  };
  useKeyboardShortcuts(
    {
      c: () => {
        if (box.data?.status === 'active' && canMailbox(box.data, 'send')) openComposer('new');
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConfigurableTable
          listKey="mail-threads"
          showSearch={false}
          mode="server"
          data={items}
          total={threads.data?.total ?? 0}
          isLoading={threads.isLoading}
          isFetching={threads.isFetching}
          error={threads.error}
          onRetry={() => void threads.refetch()}
          query={{
            page: search.page,
            pageSize: search.pageSize,
            search: search.q,
            filters: search.columns,
            sort: search.columnSort,
          }}
          onQueryChange={(q) =>
            change({
              page: q.page,
              pageSize: q.pageSize,
              q: q.search,
              columns: q.filters,
              columnSort: q.sort,
            })
          }
          selectable
          selectedIds={selected}
          onSelectionChange={(ids) => setSelection({ context, ids })}
          columns={[
            {
              id: 'subject',
              header: 'Assunto',
              hideable: false,
              cell: (t) => (
                <Button
                  variant="ghost"
                  className="h-auto min-w-48 max-w-64 justify-start whitespace-normal px-2 text-left text-xs sm:h-auto"
                  aria-current={search.thread === t.id ? 'true' : undefined}
                  onClick={() => change({ thread: t.id })}
                >
                  <span className={t.is_unread ? 'break-words font-semibold' : 'break-words'}>
                    {t.is_unread && <span className="sr-only">Não lida: </span>}
                    {t.subject || '(Sem assunto)'}
                    {t.is_pinned ? ' · Fixada' : ''}
                    {t.is_overdue ? ' · Atrasada' : ''}
                    {t.has_attachments ? ' · Com anexos' : ''}
                  </span>
                </Button>
              ),
            },
            {
              id: 'latest_from',
              header: 'Remetente',
              cell: (t) => (
                <span title={t.latest_from.address}>
                  {t.latest_from.name || t.latest_from.address}
                </span>
              ),
            },
            {
              id: 'last_message_at',
              header: 'Data e hora',
              cell: (t) =>
                t.last_message_at
                  ? new Date(t.last_message_at).toLocaleString('pt-BR', {
                      timeZone: me.data?.preferences.timezone,
                    })
                  : '',
            },
            {
              id: 'queue_status',
              header: 'Fila',
              cell: (t) => <QueueStatusBadge status={t.queue_status} />,
            },
            {
              id: 'assigned_to',
              header: 'Responsável',
              cell: (t) => t.assigned_to?.full_name ?? 'Sem responsável',
            },
            { id: 'message_count', header: 'Mensagens', align: 'right', defaultVisible: false },
            {
              id: 'labels',
              header: 'Etiquetas',
              sortable: false,
              cell: (t) => (
                <div className="flex flex-wrap gap-1">
                  {t.labels.map((label) => (
                    <LabelBadge key={label.id} label={label} />
                  ))}
                </div>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
  const reading = search.thread ? (
    <ThreadView
      key={search.thread}
      threadId={search.thread}
      mailboxId={mailboxId}
      folders={folders.data ?? []}
      onClose={close}
      onCompose={box.data && canMailbox(box.data, 'send') ? openComposer : undefined}
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
          {canMailbox(box.data, 'send') && (
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
      {search.compose && canMailbox(box.data, 'send') && (
        <Composer
          key={mailboxId + ':' + composerSession}
          ref={composer}
          mailboxId={mailboxId}
          mode={search.compose}
          initialRecipient={
            search.toEmail ? { address: search.toEmail, name: search.toName ?? '' } : undefined
          }
          threadId={search.thread}
          onClose={() => change({ compose: undefined, toEmail: undefined, toName: undefined })}
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
