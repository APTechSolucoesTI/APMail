import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Inbox, UserCheck, Hourglass, Clock, CheckCircle2, AlarmClock } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { cn } from '@/lib/utils';
const queues = [
  ['to_reply', 'A responder', Inbox],
  ['in_progress', 'Em atendimento', UserCheck],
  ['awaiting_reply', 'Aguardando resposta', Hourglass],
  ['scheduled', 'Agendado', Clock],
  ['done', 'Concluído', CheckCircle2],
  ['overdue', 'Fora do SLA', AlarmClock],
] as const;
export function QueueNavigation({
  mailboxId,
  onNavigate,
}: {
  mailboxId: string;
  onNavigate: () => void;
}) {
  const q = useQuery({
      queryKey: ['queue-counts', useTenantId(), mailboxId],
      queryFn: () => api<Record<string, number>>('/mailboxes/' + mailboxId + '/queue-counts'),
      refetchInterval: 60000,
    }),
    search = useLocation().search as { view?: string; queue?: string };
  return (
    <div className="min-w-0 space-y-1">
      {queues.map(([queue, label, Icon]) => (
        <Link
          key={queue}
          to="/mail/$mailboxId"
          params={{ mailboxId }}
          search={{ view: 'queue', queue }}
          onClick={onNavigate}
          className={cn(
            'flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted',
            search.view === 'queue' &&
              search.queue === queue &&
              'bg-secondary text-secondary-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          <span
            className="shrink-0 font-mono text-xs tabular-nums"
            aria-label={queue === 'done' ? 'Concluídas nos últimos 7 dias' : undefined}
          >
            {q.data?.[queue === 'done' ? 'done_7d' : queue] ?? '…'}
          </span>
        </Link>
      ))}
    </div>
  );
}
