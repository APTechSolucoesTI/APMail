import { useRef, useState, type ReactNode } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import { useMailDrop } from '@/hooks/use-mail-drop';
import {
  activeMailDrag,
  clearMailDrag,
  readMailDrag,
  reorderIds,
  writeMailDrag,
} from '@/lib/mail-drag';
import { folderLabel, type Folder } from '@/lib/mail';
import { cn } from '@/lib/utils';
export function FolderRow({
  folder,
  mailboxId,
  siblings,
  organize,
  reorder = true,
  children,
}: {
  folder: Folder;
  mailboxId: string;
  siblings: Folder[];
  organize: boolean;
  reorder?: boolean;
  children: ReactNode;
}) {
  const navigation = useMailNavigation(),
    label = folderLabel(folder);
  const favorite = navigation.config.favorite_folder_ids.includes(folder.id);
  const [insertion, setInsertion] = useState<'before' | 'after' | null>(null),
    [dragging, setDragging] = useState(false);
  const drop = useMailDrop(mailboxId, folder.id, organize);
  const blockedStart = useRef(false);
  const canReorder =
    reorder &&
    siblings.length > 1 &&
    !navigation.busy &&
    !navigation.isLoading &&
    !navigation.isError;
  const interactive = (target: EventTarget) =>
    target instanceof Element &&
    !!target.closest('button, input, textarea, select, [role=button], [contenteditable=true]');
  const order = siblings.map((f) => f.id),
    index = order.indexOf(folder.id);
  const move = (source: string) => {
    const ids = reorderIds(order, source, folder.id);
    if (ids !== order)
      navigation.save({ type: 'folders', mailbox_id: mailboxId, parent_id: folder.parent_id, ids });
  };
  return (
    <div
      className={cn(
        'group/folder-row relative flex min-w-0 items-center rounded-md transition-[background-color,box-shadow,opacity] duration-150 motion-reduce:transition-none',
        canReorder && 'cursor-grab hover:bg-muted/50 active:cursor-grabbing [&_a]:cursor-grab',
        dragging && 'opacity-40',
        drop.over && 'bg-accent ring-2 ring-inset ring-primary',
        insertion === 'before' &&
          'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
        insertion === 'after' &&
          'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
      )}
      aria-busy={drop.busy || navigation.busy}
      draggable={canReorder}
      aria-description={
        canReorder
          ? 'Arraste para reordenar entre pastas do mesmo nível. Pelo teclado, use Alt e seta para cima ou para baixo.'
          : undefined
      }
      onPointerDown={(event) => {
        blockedStart.current = interactive(event.target);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        if (!canReorder || blockedStart.current || interactive(event.target)) {
          event.preventDefault();
          return;
        }
        writeMailDrag(event.dataTransfer, {
          kind: 'folder',
          mailboxId,
          id: folder.id,
          parentId: folder.parent_id,
        });
        setDragging(true);
      }}
      onDragEnd={() => {
        clearMailDrag();
        setDragging(false);
        setInsertion(null);
        blockedStart.current = false;
      }}
      onKeyDown={(event) => {
        if (
          !canReorder ||
          !event.altKey ||
          interactive(event.target) ||
          (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const target = order[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target)
          navigation.save({
            type: 'folders',
            mailbox_id: mailboxId,
            parent_id: folder.parent_id,
            ids: reorderIds(order, folder.id, target),
          });
      }}
      onDragOver={(event) => {
        const drag = activeMailDrag();
        if (
          reorder &&
          !navigation.busy &&
          drag?.kind === 'folder' &&
          drag.id !== folder.id &&
          drag.mailboxId === mailboxId &&
          drag.parentId === folder.parent_id
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setInsertion(order.indexOf(drag.id) < index ? 'after' : 'before');
        } else drop.handlers.onDragOver(event);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertion(null);
        drop.handlers.onDragLeave(event);
      }}
      onDrop={(event) => {
        setInsertion(null);
        const drag = readMailDrag(event.dataTransfer);
        if (drag?.kind === 'folder') {
          event.preventDefault();
          event.stopPropagation();
          if (
            reorder &&
            !navigation.busy &&
            drag.mailboxId === mailboxId &&
            drag.parentId === folder.parent_id
          )
            move(drag.id);
          return;
        }
        void drop.handlers.onDrop(event);
      }}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {drop.busy ? (
        <Loader2
          className="mx-2 size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-label="Movendo e-mails"
        />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={navigation.busy || navigation.isLoading || navigation.isError}
          aria-label={(favorite ? 'Remover dos favoritos: ' : 'Adicionar aos favoritos: ') + label}
          aria-pressed={favorite}
          title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          className={cn(
            'size-11 shrink-0 lg:size-6',
            !favorite &&
              'lg:opacity-0 lg:group-hover/folder-row:opacity-100 lg:group-focus-within/folder-row:opacity-100',
          )}
          onClick={() =>
            navigation.save({
              type: 'favorite',
              mailbox_id: mailboxId,
              folder_id: folder.id,
              value: !favorite,
            })
          }
        >
          <Star className={cn('size-3.5', favorite && 'fill-primary text-primary')} />
        </Button>
      )}
    </div>
  );
}
