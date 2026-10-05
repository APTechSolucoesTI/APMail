import { Link } from '@tanstack/react-router';
import {
  Inbox,
  Send,
  File,
  Archive,
  Trash2,
  ShieldAlert,
  Folder as FolderIcon,
} from 'lucide-react';
import { folderLabel, type Folder } from '@/lib/mail';
import { FolderControls } from './folder-controls';
import { cn } from '@/lib/utils';
const icons = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  archive: Archive,
  trash: Trash2,
  junk: ShieldAlert,
};
export function FolderTree({
  folders,
  mailboxId,
  activeId,
  onNavigate,
  organize = false,
}: {
  folders: Folder[];
  mailboxId: string;
  activeId?: string;
  onNavigate?: () => void;
  organize?: boolean;
}) {
  return (
    <ul className="min-w-0 space-y-1">
      {folders.map((f) => {
        const Icon = icons[f.special_use as keyof typeof icons] ?? FolderIcon;
        return (
          <li key={f.id}>
            {organize ? (
              <FolderControls mailboxId={mailboxId} folder={f}>
                {' '}
                <Link
                  to="/mail/$mailboxId"
                  params={{ mailboxId }}
                  search={{ folderId: f.id }}
                  onClick={onNavigate}
                  className={cn(
                    'flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted',
                    activeId === f.id && 'bg-secondary text-secondary-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={folderLabel(f)}>
                    {folderLabel(f)}
                  </span>
                  {f.unread_count > 0 && (
                    <span
                      className="shrink-0 font-mono text-xs tabular-nums"
                      aria-label={f.unread_count + ' não lidas'}
                    >
                      {f.unread_count}
                    </span>
                  )}
                </Link>
              </FolderControls>
            ) : (
              <Link
                to="/mail/$mailboxId"
                params={{ mailboxId }}
                search={{ folderId: f.id }}
                onClick={onNavigate}
                className={cn(
                  'flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted',
                  activeId === f.id && 'bg-secondary text-secondary-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={folderLabel(f)}>
                  {folderLabel(f)}
                </span>
                {f.unread_count > 0 && (
                  <span
                    className="shrink-0 font-mono text-xs tabular-nums"
                    aria-label={f.unread_count + ' não lidas'}
                  >
                    {f.unread_count}
                  </span>
                )}
              </Link>
            )}
            {!!f.children.length && (
              <div className="ml-4 border-l pl-1">
                <FolderTree
                  folders={f.children}
                  mailboxId={mailboxId}
                  activeId={activeId}
                  onNavigate={onNavigate}
                  organize={organize}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
