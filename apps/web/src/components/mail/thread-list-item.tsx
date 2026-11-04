import {
  Paperclip,
  Pin,
  ListTodo,
  CheckCheck,
  Mail,
  Trash2,
  Loader2,
  Flag,
  Reply,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { QueueStatusBadge, OverdueBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { cn } from '@/lib/utils';
import { threadDetailKey, type Thread, type ThreadDetail } from '@/lib/mail';
import { LabelBadge } from './label-badge';
import { SearchHighlight } from './search-highlight';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canMailbox,
  meQuery,
  useAccess,
  useMailQueues,
  useTenantId,
  type Mailbox,
} from '@/lib/auth';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { resolveAddress, type ContactResolution } from '@apmail/shared';
import { useMessageDrag } from '@/hooks/use-message-drag';
import { useCutMail } from '@/lib/mail-cut';
export function ThreadListItem({
  thread,
  selected,
  active,
  onSelect,
  onOpen,
  query,
  contacts = {},
  showMailbox = false,
  drag,
  onQuickTrash,
  mailbox,
}: {
  thread: Thread;
  selected: boolean;
  active: boolean;
  onSelect: (value: boolean) => void;
  onOpen: () => void;
  query?: string;
  contacts?: ContactResolution;
  showMailbox?: boolean;
  drag?: { mailboxId: string; threadIds: string[]; messageIds: string[] };
  onQuickTrash?: () => Promise<void>;
  mailbox?: Mailbox;
}) {
  const date = thread.last_message_at ? new Date(thread.last_message_at) : null;
  const identity =
    thread.direction === 'outbound' && thread.latest_to?.length
      ? thread.latest_to[0]!
      : thread.latest_from;
  const sender = resolveAddress(identity, contacts);
  const me = useQuery(meQuery).data;
  const timeZone = me?.preferences.timezone ?? 'America/Sao_Paulo';
  const queuesEnabled = useMailQueues();
  const fullTime = date?.toLocaleString('pt-BR', { timeZone });
  const dragging = useMessageDrag(drag);
  const tenant = useTenantId();
  const { cut } = useCutMail(tenant, me?.user.id);
  const isCut =
    cut?.threadId === thread.id &&
    (!thread.message_id || cut.messages.some((message) => message.id === thread.message_id));
  const client = useQueryClient();
  const mayFlag =
    useAccess('mail.flag') &&
    !!mailbox &&
    canMailbox(mailbox, 'organize') &&
    canMailbox(mailbox, 'flag');
  const mayPin = !!mailbox && canMailbox(mailbox, 'read');
  const [pending, setPending] = useState<'trash' | 'flag' | 'pin' | null>(null);
  const actionLock = useRef(false);
  const run = async (action: NonNullable<typeof pending>, work: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setPending(action);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar o e-mail.');
    } finally {
      actionLock.current = false;
      setPending(null);
    }
  };
  const refresh = async () => {
    await Promise.all(
      ['threads', 'thread'].map((key) => client.invalidateQueries({ queryKey: [key, tenant] })),
    );
  };
  const flag = async () => {
    if (!mailbox) return;
    const detail = thread.message_id
      ? undefined
      : await client.fetchQuery({
          queryKey: threadDetailKey(tenant, thread.id),
          queryFn: () => api<ThreadDetail>('/threads/' + thread.id),
        });
    const messageIds = thread.message_id
      ? [thread.message_id]
      : (detail?.messages.map((message) => message.id) ?? []);
    if (!messageIds.length) throw new Error('Não há mensagens disponíveis para sinalizar.');
    const flagged = detail
      ? detail.messages.some((message) => message.is_flagged)
      : thread.is_flagged;
    await api('/mailboxes/' + mailbox.id + '/messages/actions', {
      method: 'POST',
      body: { type: 'set_flag', message_ids: messageIds, flagged: !flagged },
    });
    await refresh();
  };
  const pin = async () => {
    await api('/threads/' + thread.id + '/pin', { method: 'POST', body: { scope: 'personal' } });
    await refresh();
  };
  const hasActions = onQuickTrash || mayFlag || mayPin;
  const pinLabel = thread.is_pinned_personal
    ? 'Desafixar conversa para mim'
    : 'Fixar conversa para mim';
  const flagLabel = thread.is_flagged ? 'Remover sinalização' : 'Sinalizar';
  const actionClass =
    'size-11 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:text-foreground lg:size-8';
  return (
    <article
      {...dragging.handlers}
      data-flagged={thread.is_flagged || undefined}
      className={cn(
        'relative flex items-start gap-2 border-b p-3 hover:bg-primary/10',
        thread.is_unread && 'bg-primary/5',
        selected && 'bg-primary/15 hover:bg-primary/20',
        active && 'bg-primary/20 hover:bg-primary/25',
        drag &&
          'cursor-grab active:cursor-grabbing transition-[opacity,background-color,box-shadow] motion-reduce:transition-none',
        dragging.dragging && 'opacity-50 bg-accent ring-2 ring-inset ring-primary',
        isCut && 'opacity-50',
      )}
    >
      <Checkbox
        className="mt-2"
        checked={selected}
        aria-label={'Selecionar ' + (thread.subject || 'conversa sem assunto')}
        onCheckedChange={(v) => onSelect(v === true)}
      />
      <button
        type="button"
        data-mail-row-open
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        aria-label={(thread.is_unread ? 'Não lida: ' : '') + (thread.subject || '(Sem assunto)')}
        className={cn(
          'min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          thread.is_flagged && 'text-danger-fg [&_.text-muted-foreground]:text-danger-fg',
        )}
      >
        <div className="flex items-center gap-2">
          {thread.is_unread && (
            <span className="size-2 shrink-0 rounded-full bg-primary">
              <span className="sr-only">Não lida</span>
            </span>
          )}
          {thread.has_reply && (
            <span
              className="shrink-0"
              role="img"
              aria-label="Resposta enviada"
              title="Resposta enviada"
            >
              <Reply className="size-4" aria-hidden />
            </span>
          )}
          <p
            className={cn('min-w-0 flex-1 truncate text-sm', thread.is_unread && 'font-semibold')}
            title={sender.name + ' — ' + identity.address}
          >
            {sender.name || thread.participants.join(', ')}
          </p>
          {thread.message_count > 1 && (
            <span
              className="text-xs text-muted-foreground"
              aria-label={thread.message_count + ' mensagens'}
            >
              {thread.message_count}
            </span>
          )}
          <time
            dateTime={thread.last_message_at ?? undefined}
            title={fullTime}
            aria-label={fullTime}
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {date
              ?.toLocaleString('pt-BR', {
                timeZone,
                day: '2-digit',
                month: '2-digit',
                ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
                hour: '2-digit',
                minute: '2-digit',
              })
              .replace(',', '')}
          </time>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate" title={identity.address}>
            {identity.address}
          </span>
          {!sender.contact && identity.address && (
            <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium">
              Não cadastrado
            </span>
          )}
          {thread.direction === 'outbound' && (thread.latest_to?.length ?? 0) > 1 && (
            <span>+{thread.latest_to!.length - 1}</span>
          )}
        </div>
        {thread.read_receipt_status && (
          <p className="mt-1 text-xs text-muted-foreground">
            {thread.read_receipt_status === 'confirmed'
              ? 'Leitura confirmada'
              : 'Aguardando confirmação'}
          </p>
        )}
        <p
          className={cn('mt-1 truncate text-sm', thread.is_unread && 'font-semibold')}
          title={thread.subject}
        >
          {thread.subject || '(Sem assunto)'}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={thread.snippet}>
          <SearchHighlight text={thread.snippet} query={query} />
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {showMailbox && thread.mailbox_name && thread.mailbox_email && (
            <span
              className="inline-flex max-w-full items-center gap-1 truncate rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              title={thread.mailbox_name + ' · ' + thread.mailbox_email}
            >
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{thread.mailbox_email}</span>
            </span>
          )}
          {!!thread.pending_task_count && (
            <span
              className="inline-flex items-center gap-1 text-xs text-primary"
              title="Tarefas pendentes"
            >
              <ListTodo className="size-3" />
              {thread.pending_task_count} pendente(s)
            </span>
          )}
          {!!thread.completed_task_count && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="Tarefas concluídas"
            >
              <CheckCheck className="size-3" />
              {thread.completed_task_count} concluída(s)
            </span>
          )}
          {queuesEnabled && <QueueStatusBadge status={thread.queue_status} />}
          {queuesEnabled && thread.is_overdue && <OverdueBadge />}
          {queuesEnabled && thread.assigned_to && (
            <span
              title={'Responsável: ' + thread.assigned_to.full_name}
              aria-label={'Responsável: ' + thread.assigned_to.full_name}
            >
              <UserAvatar
                name={thread.assigned_to.full_name}
                src={thread.assigned_to.avatar_url}
                size={20}
              />
            </span>
          )}
          {thread.has_attachments && (
            <Paperclip className="size-3 text-muted-foreground" aria-label="Com anexos" />
          )}
          {thread.is_pinned && (!mayPin || thread.is_pinned_global) && (
            <Pin
              className="size-3 text-muted-foreground"
              aria-label={thread.is_pinned_global ? 'Fixada para a caixa' : 'Fixada para mim'}
            />
          )}
        </div>
        {!!thread.labels?.length && (
          <div className="mt-1 flex flex-wrap gap-1">
            {thread.labels.slice(0, 2).map((label) => (
              <LabelBadge key={label.id} label={label} />
            ))}
            {thread.labels.length > 2 && (
              <span
                className="text-xs text-muted-foreground"
                title={thread.labels
                  .slice(2)
                  .map((l) => l.name)
                  .join(', ')}
              >
                +{thread.labels.length - 2}
              </span>
            )}
          </div>
        )}
      </button>
      {hasActions && (
        <div
          className="-my-2 -mr-2 flex shrink-0 flex-col"
          role="group"
          aria-label={'Ações rápidas de ' + (thread.subject || 'conversa sem assunto')}
        >
          {onQuickTrash && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-mail-drag-ignore
              draggable={false}
              className={cn(
                actionClass,
                'hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive',
              )}
              aria-label={'Mover para a lixeira: ' + (thread.subject || 'conversa sem assunto')}
              title="Mover para a lixeira"
              disabled={!!pending}
              onClick={(event) => {
                event.stopPropagation();
                void run('trash', onQuickTrash);
              }}
            >
              {pending === 'trash' ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Trash2 />
              )}
            </Button>
          )}
          {mayFlag && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-mail-drag-ignore
              draggable={false}
              className={cn(
                actionClass,
                thread.is_flagged && 'text-danger-fg hover:text-danger-fg',
              )}
              aria-label={flagLabel}
              title={flagLabel}
              aria-pressed={!!thread.is_flagged}
              disabled={!!pending || thread.has_pending_message_action}
              onClick={(event) => {
                event.stopPropagation();
                void run('flag', flag);
              }}
            >
              {pending === 'flag' ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Flag className={thread.is_flagged ? 'fill-current' : undefined} />
              )}
            </Button>
          )}
          {mayPin && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-mail-drag-ignore
              draggable={false}
              className={actionClass}
              aria-label={pinLabel}
              title={pinLabel}
              aria-pressed={!!thread.is_pinned_personal}
              disabled={!!pending}
              onClick={(event) => {
                event.stopPropagation();
                void run('pin', pin);
              }}
            >
              {pending === 'pin' ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Pin className={thread.is_pinned_personal ? 'fill-current' : undefined} />
              )}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
