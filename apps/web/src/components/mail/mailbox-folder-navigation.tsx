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
  const search = location.search as { folderId?: string };
  return (
    <div>
      <Link
        to="/mail/$mailboxId"
        params={{ mailboxId: box.id }}
        onClick={onNavigate}
        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
        activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
      >
        <Mail className="size-4 shrink-0" aria-hidden />
        <span className="truncate" title={box.name}>
          {box.name}
        </span>
      </Link>
      {active && (
        <NavigationGroup id={'box-' + box.id} label="Exibir caixa">
          <div className="ml-3 border-l pl-1">
            <NavigationGroup id={'folders-' + box.id} label="Pastas">
              <FolderTree
                folders={folders.data ?? []}
                mailboxId={box.id}
                activeId={
                  search.folderId ?? folders.data?.find((f) => f.special_use === 'inbox')?.id
                }
                onNavigate={onNavigate}
                organize={can(box.role, 'organize')}
              />
              {can(box.role, 'organize') && <FolderControls mailboxId={box.id} />}
            </NavigationGroup>
            <NavigationGroup id={'labels-' + box.id} label="Minhas etiquetas">
              <PersonalLabelNavigation mailboxId={box.id} onNavigate={onNavigate} />
            </NavigationGroup>
            <NavigationGroup id={'queues-' + box.id} label="Filas">
              <QueueNavigation mailboxId={box.id} onNavigate={onNavigate} />
            </NavigationGroup>
          </div>
        </NavigationGroup>
      )}
    </div>
  );
}
