import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import type { PersonalLabel } from '@/lib/organization';
import { cn } from '@/lib/utils';
import { LabelBadge } from './label-badge';
export function PersonalLabelNavigation({
  mailboxId,
  onNavigate,
}: {
  mailboxId: string;
  onNavigate: () => void;
}) {
  const q = useQuery({
      queryKey: ['labels', useTenantId()],
      queryFn: () => api<PersonalLabel[]>('/labels'),
    }),
    search = useLocation().search as { labelId?: string; view?: string };
  if (!q.data?.length) return null;
  return (
    <div className="min-w-0 space-y-1">
      {q.data.map((l) => (
        <Link
          key={l.id}
          to="/mail/$mailboxId"
          params={{ mailboxId }}
          search={{ view: 'label', labelId: l.id }}
          onClick={onNavigate}
          className={cn(
            'flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted',
            search.view === 'label' && search.labelId === l.id && 'bg-secondary',
          )}
        >
          <Tag className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <LabelBadge label={l} />
          </span>
          <span
            className="shrink-0 font-mono text-xs tabular-nums"
            aria-label={l.thread_count + ' conversas em todas as suas caixas'}
          >
            {l.thread_count ?? 0}
          </span>
        </Link>
      ))}
    </div>
  );
}
