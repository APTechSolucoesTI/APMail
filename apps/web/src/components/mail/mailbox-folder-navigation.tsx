import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { can } from '@apmail/shared';
import { PersonalLabelNavigation } from './personal-label-navigation';
import { QueueNavigation } from './queue-navigation';
import { FolderControls } from './folder-controls';
import { Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId, type Mailbox } from '@/lib/auth';
import { FolderTree } from './folder-tree';
import type { Folder } from '@/lib/mail';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { NavigationGroup } from '@/components/layout/navigation-group';
import { cn } from '@/lib/utils';
export function MailboxFolderNavigation({
  box,
  onNavigate,
}: {
  box: Mailbox;
  onNavigate: () => void;
}) {
  const location = useLocation(),
    active = location.pathname === '/mail/' + box.id;
  const folders = useQuery({
    queryKey: ['folders', useTenantId(), box.id],
    queryFn: () => api<Folder[]>('/mailboxes/' + box.id + '/folders'),
    enabled: active,
  });
  useSocketRoom('mailbox', active ? box.id : undefined);
  const search = location.search as { folderId?: string; view?: string };
  return (
    <div className="min-w-0">
      <Link
        to="/mail/$mailboxId"
        params={{ mailboxId: box.id }}
        onClick={onNavigate}
        className={cn(
          'flex min-h-11 sm:min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active && 'bg-secondary text-secondary-foreground',
        )}
      >
        <Mail className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={box.name}>
          {box.name}
        </span>
      </Link>
      {active && (
        <div
          role="group"
          aria-label={'Navegação de ' + box.name}
          className="ml-2 mt-1 min-w-0 space-y-1 border-l pl-2"
        >
          <NavigationGroup id={'queues-' + box.id} label="Filas">
            <QueueNavigation mailboxId={box.id} onNavigate={onNavigate} />
          </NavigationGroup>
          <NavigationGroup id={'labels-' + box.id} label="Minhas etiquetas" defaultOpen={false}>
            <PersonalLabelNavigation mailboxId={box.id} onNavigate={onNavigate} />
          </NavigationGroup>
          <NavigationGroup id={'folders-' + box.id} label="Pastas">
            <FolderTree
              folders={folders.data ?? []}
              mailboxId={box.id}
              activeId={
                !search.view || search.view === 'folder'
                  ? (search.folderId ?? folders.data?.find((f) => f.special_use === 'inbox')?.id)
                  : undefined
              }
              onNavigate={onNavigate}
              organize={can(box.role, 'organize')}
            />
            {can(box.role, 'organize') && <FolderControls mailboxId={box.id} />}
          </NavigationGroup>
        </div>
      )}
    </div>
  );
}
