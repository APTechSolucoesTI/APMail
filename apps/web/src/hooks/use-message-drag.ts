import { useState, type DragEvent } from 'react';
import { clearMailDrag, writeMailDrag } from '@/lib/mail-drag';
type Scope = { mailboxId: string; threadIds: string[]; messageIds: string[] };
export function useMessageDrag(scope?: Scope) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    handlers: {
      draggable: !!scope,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (
          !scope ||
          (event.target as HTMLElement).closest('input,[role="checkbox"],[data-mail-drag-ignore]')
        ) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        writeMailDrag(event.dataTransfer, { kind: 'messages', ...scope });
        setDragging(true);
      },
      onDragEnd: () => {
        clearMailDrag();
        setDragging(false);
      },
    },
  };
}
