import { useState, type HTMLAttributes } from 'react';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import {
  activeMailDrag,
  clearMailDrag,
  readMailDrag,
  reorderIds,
  writeMailDrag,
} from '@/lib/mail-drag';
import { cn } from '@/lib/utils';
/** Props attach to the domain toggle itself, never to the mailbox/folder subtree. */
export function useDomainReorder(
  domain: string,
  siblings: string[],
): HTMLAttributes<HTMLButtonElement> {
  const navigation = useMailNavigation(),
    [dragging, setDragging] = useState(false),
    [insertion, setInsertion] = useState<'before' | 'after' | null>(null);
  const enabled =
    siblings.length > 1 && !navigation.busy && !navigation.isLoading && !navigation.isError;
  const index = siblings.indexOf(domain);
  const move = (source: string, target = domain) => {
    const ids = reorderIds(siblings, source, target);
    if (ids !== siblings) navigation.save({ type: 'domains', ids });
  };
  return {
    draggable: enabled,
    'aria-description': enabled
      ? 'Arraste para reordenar os domínios. Pelo teclado, use Alt e seta para cima ou para baixo.'
      : undefined,
    className: cn(
      'relative transition-[opacity,background-color] duration-150 motion-reduce:transition-none',
      enabled && 'cursor-grab active:cursor-grabbing',
      dragging && 'opacity-40',
      insertion === 'before' &&
        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
      insertion === 'after' &&
        'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
    ),
    onDragStart: (event) => {
      event.stopPropagation();
      if (!enabled) {
        event.preventDefault();
        return;
      }
      writeMailDrag(event.dataTransfer, { kind: 'domain', id: domain });
      setDragging(true);
    },
    onDragEnd: () => {
      clearMailDrag();
      setDragging(false);
      setInsertion(null);
    },
    onDragOver: (event) => {
      const drag = activeMailDrag();
      if (enabled && drag?.kind === 'domain' && drag.id !== domain && siblings.includes(drag.id)) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setInsertion(siblings.indexOf(drag.id) < index ? 'after' : 'before');
      }
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertion(null);
    },
    onDrop: (event) => {
      setInsertion(null);
      const drag = readMailDrag(event.dataTransfer);
      if (drag?.kind !== 'domain') return;
      event.preventDefault();
      event.stopPropagation();
      if (enabled && siblings.includes(drag.id)) move(drag.id);
    },
    onKeyDown: (event) => {
      if (!enabled || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown'))
        return;
      event.preventDefault();
      event.stopPropagation();
      const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) move(domain, target);
    },
  };
}
