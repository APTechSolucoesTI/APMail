import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useMessageDrag } from './use-message-drag';
import { readMailDrag } from '@/lib/mail-drag';
function Source() {
  const drag = useMessageDrag({ mailboxId: 'box', messageIds: ['m1', 'm2'], threadIds: [] });
  return (
    <article {...drag.handlers}>
      <button>Assunto do e-mail</button>
      <input aria-label="Selecionar e-mail" type="checkbox" />
    </article>
  );
}
it('drags the email directly without an additional handle and keeps the exact message scope', () => {
  render(<Source />);
  const data = new Map<string, string>();
  const transfer = {
    setData: (k: string, v: string) => data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
    effectAllowed: 'none',
  };
  fireEvent.dragStart(screen.getByRole('button', { name: 'Assunto do e-mail' }), {
    dataTransfer: transfer,
  });
  expect(readMailDrag(transfer as unknown as DataTransfer)).toEqual({
    kind: 'messages',
    mailboxId: 'box',
    messageIds: ['m1', 'm2'],
    threadIds: [],
  });
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
it('does not turn a checkbox selection into a message drag', () => {
  render(<Source />);
  const data = new Map<string, string>();
  const transfer = { setData: (k: string, v: string) => data.set(k, v) };
  fireEvent.dragStart(screen.getByRole('checkbox'), { dataTransfer: transfer });
  expect(data.size).toBe(0);
});
