import { Paperclip, Pin } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { QueueStatusBadge } from '@/components/common/status-badge';
import { cn } from '@/lib/utils';
import type { Thread } from '@/lib/mail';
export function ThreadListItem({
  thread,
  selected,
  active,
  onSelect,
  onOpen,
}: {
  thread: Thread;
  selected: boolean;
  active: boolean;
  onSelect: (value: boolean) => void;
  onOpen: () => void;
}) {
  const date = thread.last_message_at ? new Date(thread.last_message_at) : null;
  return (
    <article
      className={cn(
        'flex items-start gap-2 border-b p-3 hover:bg-muted/50',
        active && 'bg-secondary',
        selected && 'bg-muted',
      )}
    >
      <Checkbox
        className="mt-2"
        checked={selected}
        aria-label={'Selecionar ' + (thread.subject || 'conversa sem assunto')}
        onCheckedChange={(v) => onSelect(v === true)}
      />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          {thread.is_unread && (
            <span className="size-2 shrink-0 rounded-full bg-primary">
              <span className="sr-only">Não lida</span>
            </span>
          )}
          <p
            className={cn('min-w-0 flex-1 truncate text-sm', thread.is_unread && 'font-semibold')}
            title={thread.latest_from.name || thread.latest_from.address}
          >
            {thread.latest_from.name ||
              thread.latest_from.address ||
              thread.participants.join(', ')}
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
            title={date?.toLocaleString('pt-BR')}
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {date?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </time>
        </div>
        <p
          className={cn('mt-1 truncate text-sm', thread.is_unread && 'font-semibold')}
          title={thread.subject}
        >
          {thread.subject || '(Sem assunto)'}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={thread.snippet}>
          {thread.snippet}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <QueueStatusBadge status={thread.queue_status} />
          {thread.has_attachments && (
            <Paperclip className="size-3 text-muted-foreground" aria-label="Com anexos" />
          )}
          {thread.is_pinned && <Pin className="size-3 text-muted-foreground" aria-label="Fixada" />}
        </div>
      </button>
    </article>
  );
}
