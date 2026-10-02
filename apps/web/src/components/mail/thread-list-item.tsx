import { Paperclip, Pin } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { QueueStatusBadge, OverdueBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { cn } from '@/lib/utils';
import type { Thread } from '@/lib/mail';
import { LabelBadge } from './label-badge';
import { SearchHighlight } from './search-highlight';
import { useQuery } from '@tanstack/react-query';
import { meQuery } from '@/lib/auth';
export function ThreadListItem({
  thread,
  selected,
  active,
  onSelect,
  onOpen,
  query,
}: {
  thread: Thread;
  selected: boolean;
  active: boolean;
  onSelect: (value: boolean) => void;
  onOpen: () => void;
  query?: string;
}) {
  const date = thread.last_message_at ? new Date(thread.last_message_at) : null;
  const timeZone = useQuery(meQuery).data?.preferences.timezone ?? 'America/Sao_Paulo';
  const fullTime = date?.toLocaleString('pt-BR', { timeZone });
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
          <QueueStatusBadge status={thread.queue_status} />
          {thread.is_overdue && <OverdueBadge />}
          {thread.assigned_to && (
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
          {thread.is_pinned && <Pin className="size-3 text-muted-foreground" aria-label="Fixada" />}
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
    </article>
  );
}
