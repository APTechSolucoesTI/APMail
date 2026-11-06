import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox,
  Send,
  File,
  Archive,
  Trash2,
  ShieldAlert,
  Folder as FolderIcon,
  ChevronRight,
  FolderUp,
  Loader2,
} from 'lucide-react';
import { folderLabel, type Folder } from '@/lib/mail';
import { meQuery } from '@/lib/auth';
import { FolderControls } from './folder-controls';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FolderRow } from './folder-row';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import { activeMailDrag, readMailDrag, orderedSiblingItems } from '@/lib/mail-drag';
import { useFolderAction } from '@/hooks/use-folder-action';
const icons = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  archive: Archive,
  trash: Trash2,
  junk: ShieldAlert,
};
type Props = {
  folders: Folder[];
  mailboxId: string;
  activeId?: string;
  onNavigate?: () => void;
  organize?: boolean;
  draftsFallback?: ReactNode;
  favoritesOnly?: boolean;
};
function activeAncestors(folders: Folder[], activeId?: string, parents: string[] = []): string[] {
  for (const folder of folders) {
    if (folder.id === activeId) return parents;
    const found = activeAncestors(folder.children, activeId, [...parents, folder.id]);
    if (found.length) return found;
  }
  return [];
}
function readExpanded(key: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return Object.fromEntries(
        Object.entries(parsed).filter((entry) => typeof entry[1] === 'boolean'),
      );
  } catch {
    /* A stale preference must not prevent opening the mailbox. */
  }
  return {};
}
export function FolderTree(props: Props) {
  const me = useQuery(meQuery).data;
  const storageKey = `apmail-folders:${me?.user.id}:${me?.current_tenant_id}:${props.mailboxId}`;
  return <FolderBranches key={storageKey} {...props} storageKey={storageKey} />;
}
function FolderBranches({
  folders,
  mailboxId,
  activeId,
  onNavigate,
  organize = false,
  draftsFallback,
  storageKey,
  favoritesOnly = false,
}: Props & { storageKey: string }) {
  const navigation = useMailNavigation();
  const [draggedFolder, setDraggedFolder] = useState<Folder>(),
    [folderDragging, setFolderDragging] = useState(false),
    [rootOver, setRootOver] = useState(false);
  const rootMove = useFolderAction(mailboxId, draggedFolder);
  const canMoveToRoot = (drag: ReturnType<typeof activeMailDrag>) =>
    organize &&
    !favoritesOnly &&
    !rootMove.busy &&
    drag?.kind === 'folder' &&
    drag.mailboxId === mailboxId &&
    drag.id === draggedFolder?.id &&
    drag.parentId === draggedFolder.parent_id &&
    !!draggedFolder.parent_id &&
    !draggedFolder.special_use;
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey));
  const [collapsedForSelection, setCollapsedForSelection] = useState<
    Record<string, string | undefined>
  >({});
  const ancestors = useMemo(() => new Set(activeAncestors(folders, activeId)), [folders, activeId]);
  const toggle = (id: string, isOpen: boolean) => {
    const next = { ...expanded, [id]: !isOpen };
    setExpanded(next);
    setCollapsedForSelection((previous) => ({ ...previous, [id]: isOpen ? activeId : undefined }));
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Keep navigation usable when storage is unavailable. */
    }
  };
  const branch = (nodes: Folder[], depth = 0, parents: string[] = []) => {
    const visible = favoritesOnly
      ? nodes
      : orderedSiblingItems(nodes, mailboxId, navigation.config.folder_orders);
    const draftsIndex =
      Math.max(
        visible.findIndex((f) => f.special_use === 'inbox'),
        visible.findIndex((f) => f.special_use === 'sent'),
      ) + 1;
    return (
      <ul className="min-w-0" aria-label={depth === 0 ? 'Pastas da caixa' : undefined}>
        {visible.map((folder, index, siblings) => {
          const label = folderLabel(folder),
            path = [...parents, label].join(' / ');
          const Icon = icons[folder.special_use as keyof typeof icons] ?? FolderIcon;
          const hasChildren = !favoritesOnly && folder.children.length > 0;
          const isOpen =
            ancestors.has(folder.id) && collapsedForSelection[folder.id] !== activeId
              ? true
              : (expanded[folder.id] ?? false);
          const row = (
            <FolderRow
              folder={folder}
              mailboxId={mailboxId}
              siblings={siblings.filter((sibling) => sibling.parent_id === folder.parent_id)}
              organize={organize}
              reorder={!favoritesOnly && !rootMove.busy}
              onFolderDragChange={(source, dragging) => {
                if (dragging) setDraggedFolder(source);
                setFolderDragging(dragging);
                setRootOver(false);
              }}
            >
              <div
                className={cn(
                  'flex min-w-0 items-center rounded-md pr-1 hover:bg-primary/10',
                  ['pl-1', 'pl-4', 'pl-7', 'pl-10'][Math.min(depth, 3)],
                  activeId === folder.id &&
                    'bg-primary/20 text-secondary-foreground hover:bg-primary/25',
                )}
              >
                {hasChildren ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-11 shrink-0 rounded-sm lg:size-7"
                    aria-label={(isOpen ? 'Recolher ' : 'Expandir ') + label}
                    aria-expanded={isOpen}
                    onClick={() => toggle(folder.id, isOpen)}
                  >
                    <ChevronRight className={cn('size-3.5', isOpen && 'rotate-90')} aria-hidden />
                  </Button>
                ) : (
                  <span className="w-11 shrink-0 lg:w-7" aria-hidden />
                )}
                <Link
                  draggable={false}
                  to="/mail/$mailboxId"
                  params={{ mailboxId }}
                  search={{ folderId: folder.id }}
                  onClick={onNavigate}
                  aria-current={activeId === folder.id ? 'page' : undefined}
                  aria-label={label}
                  title={path}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm pr-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:text-xs"
                  onKeyDown={(event) => {
                    if (
                      hasChildren &&
                      ((event.key === 'ArrowRight' && !isOpen) ||
                        (event.key === 'ArrowLeft' && isOpen))
                    ) {
                      event.preventDefault();
                      toggle(folder.id, isOpen);
                    }
                  }}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {folder.unread_count > 0 && (
                    <span
                      className="shrink-0 text-xs font-semibold tabular-nums"
                      aria-label={folder.unread_count + ' não lidas'}
                    >
                      {folder.unread_count}
                    </span>
                  )}
                </Link>
              </div>
            </FolderRow>
          );
          return (
            <Fragment key={folder.id}>
              {depth === 0 && index === draftsIndex && draftsFallback && <li>{draftsFallback}</li>}
              <li>
                {organize ? (
                  <FolderControls
                    mailboxId={mailboxId}
                    folder={folder}
                    compact
                    disabled={rootMove.busy}
                  >
                    {row}
                  </FolderControls>
                ) : (
                  row
                )}
                {!favoritesOnly &&
                  hasChildren &&
                  isOpen &&
                  branch(folder.children, depth + 1, [...parents, label])}
              </li>
            </Fragment>
          );
        })}
        {depth === 0 && draftsIndex === visible.length && draftsFallback && (
          <li>{draftsFallback}</li>
        )}
      </ul>
    );
  };
  return (
    <>
      {organize && !favoritesOnly && (
        <>
          {((folderDragging && !!draggedFolder?.parent_id && !draggedFolder.special_use) ||
            rootMove.busy) && (
            <section
              role="region"
              aria-label="Mover para a raiz da caixa"
              aria-busy={rootMove.busy}
              className={cn(
                'sticky top-0 z-10 mb-2 flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-primary/50 bg-secondary px-3 py-2 text-secondary-foreground transition-colors motion-reduce:transition-none',
                rootOver && 'border-solid border-primary bg-accent ring-2 ring-inset ring-primary',
              )}
              onDragOver={(event) => {
                if (!canMoveToRoot(activeMailDrag())) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                setRootOver(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setRootOver(false);
              }}
              onDrop={(event) => {
                setRootOver(false);
                const drag = readMailDrag(event.dataTransfer);
                if (drag?.kind !== 'folder') return;
                event.preventDefault();
                event.stopPropagation();
                if (!canMoveToRoot(drag) || !draggedFolder) return;
                void rootMove.enqueue('move', draggedFolder.name, null).catch((error: unknown) => {
                  rootMove.setError(
                    error instanceof Error
                      ? error.message
                      : 'Não foi possível mover a pasta. Tente novamente.',
                  );
                });
              }}
            >
              {rootMove.busy ? (
                <Loader2
                  className="size-5 shrink-0 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <FolderUp className="size-5 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 text-xs">
                <p className="font-semibold">Raiz da caixa</p>
                {rootMove.busy ? (
                  <p role="status">Aplicando no servidor…</p>
                ) : (
                  <p>Solte aqui para retirar da subpasta.</p>
                )}
              </div>
            </section>
          )}
          {rootMove.error && (
            <p role="alert" className="mb-2 px-2 text-xs text-destructive">
              {rootMove.error}
            </p>
          )}
        </>
      )}
      {branch(folders)}
    </>
  );
}
