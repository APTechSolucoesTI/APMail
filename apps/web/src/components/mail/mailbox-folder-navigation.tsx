import { Link, useLocation } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { can } from '@apmail/shared';
import { PersonalLabelNavigation } from './personal-label-navigation';
import { QueueNavigation } from './queue-navigation';
import { FolderControls } from './folder-controls';
import { Mail, ChevronRight, FilePenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTenantId, useMailQueues, meQuery, type Mailbox } from '@/lib/auth';
import { FolderTree } from './folder-tree';
import { flattenFolders, type Folder } from '@/lib/mail';
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
  const tenantId = useTenantId();
  const me = useQuery(meQuery).data;
  const storageKey = `apmail-mailbox:${me?.user.id}:${tenantId ?? me?.current_tenant_id}:${box.id}`;
  return (
    <MailboxNavigation key={storageKey} box={box} onNavigate={onNavigate} storageKey={storageKey} />
  );
}
function MailboxNavigation({
  box,
  onNavigate,
  storageKey,
}: {
  box: Mailbox;
  onNavigate: () => void;
  storageKey: string;
}) {
  const location = useLocation(),
    active = location.pathname === '/mail/' + box.id;
  const controlsId = useId();
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'true' || (saved !== 'false' && active);
    } catch {
      return active;
    }
  });
  const setOpen = (open: boolean) => {
    setExpanded(open);
    try {
      localStorage.setItem(storageKey, String(open));
    } catch {
      /* Navigation works without storage. */
    }
  };
  const folders = useQuery({
    queryKey: ['folders', useTenantId(), box.id],
    queryFn: () => api<Folder[]>('/mailboxes/' + box.id + '/folders'),
    enabled: expanded,
  });
  useSocketRoom('mailbox', expanded ? box.id : undefined);
  const queuesEnabled = useMailQueues();
  const search = location.search as { folderId?: string; view?: string };
  return (
    <div className="min-w-0">
      <div
        className={cn(
          'flex min-w-0 items-center rounded-md',
          active && 'bg-secondary text-secondary-foreground',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-11 shrink-0 sm:size-8"
          aria-label={(expanded ? 'Recolher ' : 'Expandir ') + box.name}
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={() => setOpen(!expanded)}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 transition-transform motion-reduce:transition-none',
              expanded && 'rotate-90',
            )}
          />
        </Button>
        <Link
          to="/mail/$mailboxId"
          params={{ mailboxId: box.id }}
          onClick={() => {
            setOpen(true);
            onNavigate();
          }}
          aria-current={active ? 'page' : undefined}
          onKeyDown={(event) => {
            if (
              (event.key === 'ArrowRight' && !expanded) ||
              (event.key === 'ArrowLeft' && expanded)
            ) {
              event.preventDefault();
              setOpen(!expanded);
            }
          }}
          className={cn(
            'flex min-h-11 sm:min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Mail className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={box.name}>
            {box.name}
          </span>
        </Link>
      </div>
      {expanded && (
        <div
          id={controlsId}
          role="group"
          aria-label={'Navegação de ' + box.name}
          className="ml-2 mt-1 min-w-0 space-y-1 border-l pl-2"
        >
          {queuesEnabled && (
            <NavigationGroup id={'queues-' + box.id} label="Filas">
              <QueueNavigation mailboxId={box.id} onNavigate={onNavigate} />
            </NavigationGroup>
          )}
          <NavigationGroup id={'labels-' + box.id} label="Minhas etiquetas" defaultOpen={false}>
            <PersonalLabelNavigation mailboxId={box.id} onNavigate={onNavigate} />
          </NavigationGroup>
          <NavigationGroup id={'folders-' + box.id} label="Pastas">
            {folders.isPending && (
              <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
                Carregando pastas…
              </p>
            )}
            {folders.isError && (
              <p role="alert" className="px-2 py-2 text-xs text-muted-foreground">
                Não foi possível carregar as pastas.{' '}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => void folders.refetch()}
                >
                  Tentar novamente
                </button>
              </p>
            )}
            <FolderTree
              folders={folders.data ?? []}
              mailboxId={box.id}
              activeId={
                active && (!search.view || search.view === 'folder')
                  ? (search.folderId ?? folders.data?.find((f) => f.special_use === 'inbox')?.id)
                  : undefined
              }
              onNavigate={onNavigate}
              organize={can(box.role, 'organize')}
              draftsFallback={
                folders.isSuccess &&
                !flattenFolders(folders.data).some((f) => f.special_use === 'drafts') ? (
                  <Link
                    to="/mail/$mailboxId"
                    params={{ mailboxId: box.id }}
                    search={{ view: 'drafts' }}
                    onClick={onNavigate}
                    aria-label="Rascunhos"
                    aria-current={active && search.view === 'drafts' ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-md pl-12 pr-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:pl-9',
                      active &&
                        search.view === 'drafts' &&
                        'bg-secondary text-secondary-foreground',
                    )}
                  >
                    <FilePenLine className="size-4 shrink-0" aria-hidden />
                    <span>Rascunhos</span>
                  </Link>
                ) : undefined
              }
            />
            {can(box.role, 'organize') && <FolderControls mailboxId={box.id} />}
          </NavigationGroup>
        </div>
      )}
    </div>
  );
}
