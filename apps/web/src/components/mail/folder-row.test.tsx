import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FolderRow } from './folder-row';
import { activeMailDrag, clearMailDrag, writeMailDrag } from '@/lib/mail-drag';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import type { Folder } from '@/lib/mail';
const drop = vi.hoisted(() => ({ onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() }));
vi.mock('@/hooks/use-mail-navigation', () => ({ useMailNavigation: vi.fn() }));
vi.mock('@/hooks/use-mail-drop', () => ({
  useMailDrop: () => ({ busy: false, over: false, handlers: drop }),
}));
const folders: Folder[] = ['a', 'b'].map((id) => ({
  id,
  name: id,
  parent_id: null,
  special_use: null,
  children: [],
  unread_count: 0,
}));
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
      {folders.map((folder) => (
        <FolderRow key={folder.id} folder={folder} mailboxId="box" siblings={folders} organize>
          <a href={'#' + folder.id} draggable={false}>
            {folder.name}
          </a>
          <button>Opções {folder.id}</button>
        </FolderRow>
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
it('drags the whole folder row from its link without a grip and reorders siblings only', () => {
  const save = mount(),
    dataTransfer = transfer(),
    link = screen.getByRole('link', { name: 'a' });
  expect(screen.queryByRole('button', { name: 'Reordenar a' })).not.toBeInTheDocument();
  expect(link.closest('[draggable=true]')).not.toBeNull();
  fireEvent.dragStart(link, { dataTransfer });
  expect(activeMailDrag()).toEqual({ kind: 'folder', mailboxId: 'box', id: 'a', parentId: null });
  const target = screen.getByRole('link', { name: 'b' });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(save).toHaveBeenCalledWith({
    type: 'folders',
    mailbox_id: 'box',
    parent_id: null,
    ids: ['b', 'a'],
  });
  save.mockClear();
  writeMailDrag(dataTransfer, { kind: 'folder', mailboxId: 'box', id: 'a', parentId: 'elsewhere' });
  fireEvent.drop(target, { dataTransfer });
  expect(save).not.toHaveBeenCalled();
});
it('uses Alt+Arrow from the link and leaves buttons and unmodified arrows alone', () => {
  const save = mount(),
    link = screen.getByRole('link', { name: 'b' });
  fireEvent.keyDown(link, { key: 'ArrowUp' });
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(link, { key: 'ArrowUp', altKey: true });
  expect(save).toHaveBeenCalledWith({
    type: 'folders',
    mailbox_id: 'box',
    parent_id: null,
    ids: ['b', 'a'],
  });
  save.mockClear();
  const button = screen.getByRole('button', { name: 'Opções b' });
  fireEvent.keyDown(button, { key: 'ArrowUp', altKey: true });
  expect(save).not.toHaveBeenCalled();
  fireEvent.dragStart(button, { dataTransfer: transfer() });
  expect(activeMailDrag()).toBeNull();
});
it('continues forwarding message drops to the existing move handler', () => {
  mount();
  const dataTransfer = transfer();
  writeMailDrag(dataTransfer, {
    kind: 'messages',
    mailboxId: 'box',
    threadIds: ['thread'],
    messageIds: [],
  });
  fireEvent.drop(screen.getByRole('link', { name: 'b' }), { dataTransfer });
  expect(drop.onDrop).toHaveBeenCalledOnce();
});
