import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MailboxReorder, useMailboxReorder } from './mailbox-reorder';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import { activeMailDrag, clearMailDrag, writeMailDrag } from '@/lib/mail-drag';
import type { Mailbox } from '@/lib/auth';
vi.mock('@/hooks/use-mail-navigation', () => ({ useMailNavigation: vi.fn() }));
const boxes = [
  { id: 'a', name: 'Comercial' },
  { id: 'b', name: 'Financeiro' },
] as Mailbox[];
function Header({ name }: { name: string }) {
  const props = useMailboxReorder();
  return (
    <>
      <div {...props} data-testid={name}>
        <a href={'#' + name} draggable={false}>
          {name}
        </a>
        <button>Opções {name}</button>
      </div>
      <div data-testid={'content-' + name}>Pastas da caixa</div>
    </>
  );
}
function transfer() {
  const values = new Map<string, string>();
  return {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    effectAllowed: '',
    dropEffect: '',
  } as unknown as DataTransfer;
}
function mount() {
  const save = vi.fn();
  vi.mocked(useMailNavigation).mockReturnValue({
    save,
    busy: false,
    isLoading: false,
    isError: false,
    config: { mailbox_order: [], folder_orders: {}, favorite_folder_ids: [] },
  } as unknown as ReturnType<typeof useMailNavigation>);
  render(
    <>
      {boxes.map((box) => (
        <MailboxReorder
          key={box.id}
          box={box}
          siblings={boxes}
          allBoxes={[boxes[0]!, { id: 'hidden' } as Mailbox, boxes[1]!]}
        >
          <Header name={box.name} />
        </MailboxReorder>
      ))}
    </>,
  );
  return save;
}
afterEach(() => {
  cleanup();
  clearMailDrag();
  vi.clearAllMocks();
});
it('reorders via Alt+Arrow bubbling from header link and preserves hidden group siblings', () => {
  const save = mount(),
    link = screen.getByRole('link', { name: 'Financeiro' });
  expect(
    screen.queryByRole('button', { name: 'Reordenar caixa Financeiro' }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(link, { key: 'ArrowUp' });
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(link, { key: 'ArrowUp', altKey: true });
  expect(save).toHaveBeenCalledWith({ type: 'mailboxes', ids: ['b', 'hidden', 'a'] });
});
it('starts direct drag only on the header and accepts mailbox drops without nesting', () => {
  const save = mount(),
    dataTransfer = transfer(),
    header = screen.getByTestId('Comercial');
  expect(header).toHaveAttribute('draggable', 'true');
  expect(screen.getByTestId('content-Comercial')).not.toHaveAttribute('draggable', 'true');
  fireEvent.dragStart(screen.getByRole('link', { name: 'Comercial' }), { dataTransfer });
  expect(activeMailDrag()).toEqual({ kind: 'mailbox', id: 'a' });
  fireEvent.dragOver(screen.getByTestId('Financeiro'), { dataTransfer });
  fireEvent.drop(screen.getByTestId('Financeiro'), { dataTransfer });
  expect(save).toHaveBeenCalledWith({ type: 'mailboxes', ids: ['b', 'hidden', 'a'] });
  save.mockClear();
  writeMailDrag(dataTransfer, { kind: 'folder', mailboxId: 'a', id: 'folder', parentId: null });
  fireEvent.drop(screen.getByTestId('Financeiro'), { dataTransfer });
  expect(save).not.toHaveBeenCalled();
});
it('does not drag or reorder when an interactive header button is used', () => {
  const save = mount(),
    button = screen.getByRole('button', { name: 'Opções Financeiro' });
  fireEvent.dragStart(button, { dataTransfer: transfer() });
  expect(activeMailDrag()).toBeNull();
  fireEvent.keyDown(button, { key: 'ArrowUp', altKey: true });
  expect(save).not.toHaveBeenCalled();
});
