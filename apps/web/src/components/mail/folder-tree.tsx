import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { folderLabel, type Folder } from '@/lib/mail';
import { meQuery } from '@/lib/auth';
import { FolderControls } from './folder-controls';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  storageKey,
}: Props & { storageKey: string }) {
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
  const branch = (nodes: Folder[], depth = 0, parents: string[] = []) => (
    <ul className="min-w-0" aria-label={depth === 0 ? 'Pastas da caixa' : undefined}>
      {nodes.map((folder) => {
        const label = folderLabel(folder),
          path = [...parents, label].join(' / ');
        const Icon = icons[folder.special_use as keyof typeof icons] ?? FolderIcon;
        const hasChildren = folder.children.length > 0;
        const isOpen =
          ancestors.has(folder.id) && collapsedForSelection[folder.id] !== activeId
            ? true
            : (expanded[folder.id] ?? false);
        const row = (
          <div
            className={cn(
              'flex min-w-0 items-center rounded-md pr-1 hover:bg-muted',
              ['pl-1', 'pl-4', 'pl-7', 'pl-10'][Math.min(depth, 3)],
              activeId === folder.id && 'bg-secondary text-secondary-foreground',
            )}
          >
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11 shrink-0 rounded-sm lg:size-8"
                aria-label={(isOpen ? 'Recolher ' : 'Expandir ') + label}
                aria-expanded={isOpen}
                onClick={() => toggle(folder.id, isOpen)}
              >
                <ChevronRight className={cn('size-3.5', isOpen && 'rotate-90')} aria-hidden />
              </Button>
            ) : (
              <span className="w-11 shrink-0 lg:w-8" aria-hidden />
            )}
            <Link
              to="/mail/$mailboxId"
              params={{ mailboxId }}
              search={{ folderId: folder.id }}
              onClick={onNavigate}
              aria-current={activeId === folder.id ? 'page' : undefined}
              aria-label={label}
              title={path}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm pr-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8"
              onKeyDown={(event) => {
                if (
                  hasChildren &&
                  ((event.key === 'ArrowRight' && !isOpen) || (event.key === 'ArrowLeft' && isOpen))
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
        );
        return (
          <li key={folder.id}>
            {organize ? (
              <FolderControls mailboxId={mailboxId} folder={folder} compact>
                {row}
              </FolderControls>
            ) : (
              row
            )}
            {hasChildren && isOpen && branch(folder.children, depth + 1, [...parents, label])}
          </li>
        );
      })}
    </ul>
  );
  return branch(folders);
}
