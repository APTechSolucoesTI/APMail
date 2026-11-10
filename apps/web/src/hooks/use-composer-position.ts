import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Position = { left: number; top: number };
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
function read(key: string): Position | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'left' in value &&
      'top' in value &&
      typeof value.left === 'number' &&
      Number.isFinite(value.left) &&
      typeof value.top === 'number' &&
      Number.isFinite(value.top)
    )
      return { left: value.left, top: value.top };
  } catch {
    /* A blocked or invalid local preference must not block composing. */
  }
  return null;
}

/** Positions are local UI preferences. Message content is never stored here. */
export function useComposerPosition(
  key: string,
  enabled: boolean,
  surface: 'composer' | 'summary' = 'composer',
) {
  const storageKey = 'apmail-' + surface + '-position:' + key;
  const stored = useMemo(() => read(storageKey), [storageKey]);
  const [size, setSize] = useState(viewport);
  const [moved, setMoved] = useState<{ key: string; position: Position } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    start: Position;
    current: Position;
  } | null>(null);
  const maxLeft = Math.max(16, size.width - Math.min(960, size.width - 32) - 16);
  const maxTop = Math.max(16, size.height - Math.min(760, size.height - 32) - 16);
  const clamp = (position: Position): Position => ({
    left: Math.max(16, Math.min(position.left, maxLeft)),
    top: Math.max(16, Math.min(position.top, maxTop)),
  });
  const initial =
    surface === 'summary'
      ? { left: Math.round((maxLeft + 16) / 2), top: Math.round((maxTop + 16) / 2) }
      : { left: maxLeft, top: maxTop };
  const position = clamp((moved?.key === storageKey ? moved.position : stored) ?? initial);
  useEffect(() => {
    const resize = () => setSize(viewport());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const update = (value: Position, persist: boolean) => {
    const next = clamp(value);
    setMoved({ key: storageKey, position: next });
    if (persist) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Optional UI preference. */
      }
      setAnnouncement('Posição ajustada.');
    }
    return next;
  };
  return {
    style: position,
    dragging,
    announcement,
    onKeyDown: (event: KeyboardEvent) => {
      if (
        !enabled ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 60 : 20;
      update(
        event.key === 'Home'
          ? initial
          : {
              left:
                position.left +
                (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
              top:
                position.top +
                (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
            },
        true,
      );
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const button = (event.target as HTMLElement).closest('button');
      if (button && !button.hasAttribute('data-window-drag-handle')) return;
      event.preventDefault();
      button?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: position,
        current: position,
      };
      setDragging(true);
      setAnnouncement(
        surface === 'summary' ? 'Movendo janela da conversa.' : 'Movendo compositor.',
      );
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!enabled || !current || current.pointer !== event.pointerId) return;
      current.current = update(
        {
          left: current.start.left + event.clientX - current.x,
          top: current.start.top + event.clientY - current.y,
        },
        false,
      );
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      update(current.current, true);
      drag.current = null;
      setDragging(false);
    },
    onPointerCancel: () => {
      if (drag.current) update(drag.current.start, false);
      drag.current = null;
      setDragging(false);
      setAnnouncement('Movimento cancelado.');
    },
  };
}
