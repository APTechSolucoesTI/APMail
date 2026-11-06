import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useTenantId } from '@/lib/auth';
import { threadInvitationsQuery } from './thread-invitations';
export function InvitationsNavigation({ onNavigate }: { onNavigate: () => void }) {
  const q = useQuery(threadInvitationsQuery(useTenantId()));
  const count = q.data?.filter((item) => item.state === 'active').length ?? 0;
  return (
    <Link
      to="/invitations"
      onClick={onNavigate}
      activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
      className="flex min-h-11 items-center gap-2 rounded-md border border-primary/25 bg-secondary/50 px-2 text-sm font-medium text-secondary-foreground hover:bg-secondary sm:min-h-9"
    >
      <Bell className="size-4 text-primary" />
      Convites
      <span
        className="ml-auto rounded-sm bg-primary px-1.5 py-0.5 font-mono text-xs text-primary-foreground"
        aria-label={count + ' convites ativos'}
      >
        {count}
      </span>
    </Link>
  );
}
