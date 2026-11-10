import { useState } from 'react';
import { Inbox, Mail } from 'lucide-react';
import { QUEUE_LABELS } from '@apmail/shared';
import { useMailPages } from '@/hooks/use-mail-pages';
import { useTenantId } from '@/lib/auth';
import type { Thread } from '@/lib/mail';
import { cn } from '@/lib/utils';
import { Pagination } from '@/components/data/pagination';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Badge } from '@/components/ui/badge';
import { OverdueBadge } from '@/components/common/status-badge';
import { MailContextMenu } from './mail-context-menu';

const stages = ['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done'] as const;
type Stage = (typeof stages)[number];
type OpenThread = (thread: Thread, mode?: string) => void;
const pageSize = 10;

export function SummaryBoard({ filters, openThread }: { filters: string; openThread: OpenThread }) {
  const params = new URLSearchParams(filters);
  const queue = params.get('queue');
  const status = params.get('status');
  const visibleStages = stages.filter(
    (stage) =>
      (!status || status === stage) &&
      (!queue ||
        queue === stage ||
        (queue === 'overdue' && (stage === 'to_reply' || stage === 'in_progress'))),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        Acompanhe as caixas com filas ativas. Abra uma conversa para atribuir ou atualizar o
        atendimento.
      </p>
      {visibleStages.length ? (
        <div
          role="region"
          aria-label="Colunas do atendimento"
          tabIndex={0}
          className="flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          {visibleStages.map((stage) => (
            <SummaryColumn key={stage} stage={stage} filters={filters} openThread={openThread} />
          ))}
        </div>
      ) : (
        <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          Nenhuma etapa corresponde aos filtros. Ajuste o status ou volte à lista.
        </p>
      )}
    </div>
  );
}

function SummaryColumn({
  stage,
  filters,
  openThread,
}: {
  stage: Stage;
  filters: string;
  openThread: OpenThread;
}) {
  const tenant = useTenantId();
  const [page, setPage] = useState(1);
  const params = new URLSearchParams(filters);
  params.set('view', 'queue');
  params.set('queue', params.get('queue') === 'overdue' ? 'overdue' : stage);
  params.set('status', stage);
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  const result = useMailPages<Thread>({
    path: '/mail-summary/threads',
    key: ['threads', tenant, 'summary-board'],
    params,
    page,
    size: pageSize,
    refetchInterval: 30000,
  });
  const total = result.data?.total;
  if (total !== undefined && !result.isFetching && !result.isPlaceholderData) {
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) setPage(last);
  }
  return (
    <section
      aria-label={QUEUE_LABELS[stage]}
      className="flex w-[min(19rem,82vw)] shrink-0 snap-start flex-col rounded-lg border bg-card lg:w-auto lg:min-w-48 lg:max-w-md lg:flex-1"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{QUEUE_LABELS[stage]}</h2>
        {total !== undefined && (
          <Badge variant="secondary" className="tabular-nums">
            {total}
          </Badge>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2" aria-busy={result.isFetching}>
        {result.isPending ? (
          <LoadingState />
        ) : result.isError ? (
          <ErrorState onRetry={() => void result.refetch()} />
        ) : !result.data?.items.length ? (
          <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Inbox className="size-4" aria-hidden /> Nenhuma conversa nesta etapa
          </p>
        ) : (
          result.data.items.map(
            (thread) =>
              thread.mailbox_id && (
                <MailContextMenu
                  key={thread.id}
                  thread={thread}
                  mailboxId={thread.mailbox_id}
                  onOpen={() => openThread(thread)}
                  onCompose={(mode) => openThread(thread, mode)}
                >
                  <button
                    type="button"
                    onClick={() => openThread(thread)}
                    className="block w-full min-w-0 space-y-2 rounded-md border bg-background p-3 text-left hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      className={cn(
                        'flex items-start gap-2 break-words text-sm',
                        thread.is_unread && 'font-semibold',
                      )}
                    >
                      {thread.is_unread && (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                          <span className="sr-only">Não lida</span>
                        </span>
                      )}
                      <span className="min-w-0">{thread.subject || '(Sem assunto)'}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="size-3 shrink-0" aria-hidden />
                      <span className="truncate" title={thread.mailbox_email}>
                        {thread.mailbox_name ?? thread.mailbox_email}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate" title={thread.assigned_to?.full_name}>
                        {thread.assigned_to?.full_name ?? 'Sem responsável'}
                      </span>
                      {thread.is_overdue && <OverdueBadge />}
                    </span>
                  </button>
                </MailContextMenu>
              ),
          )
        )}
      </div>
      {total !== undefined && (total > pageSize || page > 1) && (
        <div className="shrink-0 border-t">
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </div>
      )}
    </section>
  );
}
