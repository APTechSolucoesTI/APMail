import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId, useMailQueues } from '@/lib/auth';
import { NavigationGroup } from '@/components/layout/navigation-group';
import { QUEUE_LABELS } from '@apmail/shared';

export function SummaryNavigation({ onNavigate }: { onNavigate: () => void }) {
  const counts = useQuery({
    queryKey: ['queue-counts', useTenantId(), 'summary'],
    queryFn: () => api<Record<string, number>>('/mail-summary/queue-counts'),
    refetchInterval: 30000,
  });
  const queues = useMailQueues();
  return (
    <NavigationGroup id="mail-summary" label="Resumo" icon={<Layers className="size-4" />}>
      <Link
        to="/mail-summary"
        search={{ view: 'folder' }}
        onClick={onNavigate}
        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted sm:min-h-8"
        activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
      >
        <Inbox className="size-4" />
        Caixas de entrada
        <span className="ml-auto font-mono text-xs">{counts.data?.unread_inbox ?? '…'}</span>
      </Link>
      {queues &&
        (
          ['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done', 'overdue'] as const
        ).map((queue) => (
          <Link
            key={queue}
            to="/mail-summary"
            search={{ view: 'queue', queue }}
            onClick={onNavigate}
            activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted sm:min-h-8"
          >
            <span className="min-w-0 flex-1">
              {queue === 'overdue' ? 'Fora do SLA' : QUEUE_LABELS[queue]}
            </span>
            <span
              className="font-mono text-xs"
              title={queue === 'done' ? 'Últimos 7 dias' : undefined}
            >
              {counts.data?.[queue === 'done' ? 'done_7d' : queue] ?? '…'}
            </span>
          </Link>
        ))}
    </NavigationGroup>
  );
}
