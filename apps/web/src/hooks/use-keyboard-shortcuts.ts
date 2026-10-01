import { useEffect } from 'react';
import { useMediaQuery } from './use-media-query';
export function useKeyboardShortcuts(handlers: Record<string, () => void>, enabled = true) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  useEffect(() => {
    if (!enabled || !desktop) return;
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
        )
      )
        return;
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
      const handler = handlers[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handlers, enabled, desktop]);
}
