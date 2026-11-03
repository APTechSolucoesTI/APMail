import {
  createContext,
  useContext,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import type { Mailbox } from '@/lib/auth';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import {
  activeMailDrag,
  clearMailDrag,
  readMailDrag,
  reorderIds,
  mergeSubsetOrder,
  writeMailDrag,
} from '@/lib/mail-drag';
import { cn } from '@/lib/utils';
const MailboxReorderContext = createContext<HTMLAttributes<HTMLDivElement> | null>(null);
/** Applied to the mailbox header only; folder descendants keep their own drag behavior. */
export const useMailboxReorder = () => useContext(MailboxReorderContext);
export function MailboxReorder({
  box,
  siblings,
  children,
  allBoxes = siblings,
}: {
  box: Mailbox;
  siblings: Mailbox[];
  children: ReactNode;
  allBoxes?: Mailbox[];
}) {
  const navigation = useMailNavigation(),
    [dragging, setDragging] = useState(false),
    [insertion, setInsertion] = useState<'before' | 'after' | null>(null),
    blockedStart = useRef(false);
  const ids = siblings.map((b) => b.id),
    index = ids.indexOf(box.id);
  const enabled =
    siblings.length > 1 && !navigation.busy && !navigation.isLoading && !navigation.isError;
  const interactive = (target: EventTarget) =>
    target instanceof Element &&
    !!target.closest('button, input, textarea, select, [role=button], [contenteditable=true]');
  const save = (order: string[]) =>
    navigation.save({
      type: 'mailboxes',
      ids: mergeSubsetOrder(
        allBoxes.map((b) => b.id),
        order,
      ),
    });
  const header: HTMLAttributes<HTMLDivElement> = {
    draggable: enabled,
    'aria-description': enabled
      ? 'Arraste para reordenar as caixas deste grupo. Pelo teclado, use Alt e seta para cima ou para baixo.'
      : undefined,
    className: cn(
      'relative transition-[opacity,background-color] duration-150 motion-reduce:transition-none',
      enabled && 'cursor-grab active:cursor-grabbing [&_a]:cursor-grab',
      dragging && 'opacity-40',
      insertion === 'before' &&
        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
      insertion === 'after' &&
        'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
    ),
    onPointerDown: (event) => {
      blockedStart.current = interactive(event.target);
    },
    onDragStart: (event) => {
      event.stopPropagation();
      if (!enabled || blockedStart.current || interactive(event.target)) {
        event.preventDefault();
        return;
      }
      writeMailDrag(event.dataTransfer, { kind: 'mailbox', id: box.id });
      setDragging(true);
    },
    onDragEnd: () => {
      clearMailDrag();
      setDragging(false);
      setInsertion(null);
      blockedStart.current = false;
    },
    onDragOver: (event) => {
      const drag = activeMailDrag();
      if (enabled && drag?.kind === 'mailbox' && drag.id !== box.id && ids.includes(drag.id)) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setInsertion(ids.indexOf(drag.id) < index ? 'after' : 'before');
      }
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertion(null);
    },
    onDrop: (event) => {
      setInsertion(null);
      const drag = readMailDrag(event.dataTransfer);
      if (drag?.kind !== 'mailbox') return;
      event.preventDefault();
      event.stopPropagation();
      if (enabled && ids.includes(drag.id) && drag.id !== box.id)
        save(reorderIds(ids, drag.id, box.id));
    },
    onKeyDown: (event) => {
      if (
        !enabled ||
        !event.altKey ||
        interactive(event.target) ||
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const target = ids[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) save(reorderIds(ids, box.id, target));
    },
  };
  return (
    <MailboxReorderContext.Provider value={header}>
      <div className="min-w-0">{children}</div>
    </MailboxReorderContext.Provider>
  );
}
