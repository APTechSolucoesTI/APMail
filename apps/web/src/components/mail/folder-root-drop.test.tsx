import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderTree } from './folder-tree';
import { api } from '@/lib/api';
import { clearMailDrag, writeMailDrag } from '@/lib/mail-drag';
import type { Folder } from '@/lib/mail';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to: _to,
    params: _params,
    search: _search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params: unknown;
    search: unknown;
  }) => (
    <a
      href="#folder"
      data-to={_to}
      data-params={JSON.stringify(_params)}
      data-search={JSON.stringify(_search)}
      {...props}
    >
      {children}
    </a>
  ),
}));
const child: Folder = {
  id: 'child',
  name: 'Projetos',
  parent_id: 'inbox',
  special_use: null,
  children: [],
  unread_count: 0,
};
const inbox: Folder = {
  id: 'inbox',
  name: 'INBOX',
  parent_id: null,
  special_use: 'inbox',
  children: [child],
  unread_count: 0,
};
function transfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: '',
    dropEffect: '',
  } as unknown as DataTransfer;
}
function mount(organize = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me'], { user: { id: 'user' }, current_tenant_id: 'tenant', tenants: [] });
  client.setQueryData(['mail-navigation', 'tenant', 'user'], {
    mailbox_order: [],
    folder_orders: {},
    favorite_folder_ids: [],
  });
  vi.mocked(api).mockImplementation(async (path, options) =>
    options?.method === 'PATCH'
      ? { action_id: 'action' }
      : path.startsWith('/folder-actions/')
        ? { status: 'processing' }
        : [inbox],
  );
  render(
    <QueryClientProvider client={client}>
      <FolderTree mailboxId="box" folders={[inbox]} activeId="child" organize={organize} />
    </QueryClientProvider>,
  );
  return client;
}
function start() {
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByRole('link', { name: 'Projetos' }), { dataTransfer });
  return dataTransfer;
}
afterEach(() => {
  cleanup();
  clearMailDrag();
  localStorage.clear();
  vi.clearAllMocks();
});

it('lets a sole child move to root, keeps the action pending and suppresses duplicate drops', async () => {
  mount();
  expect(screen.getByRole('link', { name: 'Projetos' }).closest('[draggable=true]')).not.toBeNull();
  expect(
    screen.queryByRole('region', { name: 'Mover para a raiz da caixa' }),
  ).not.toBeInTheDocument();
  const dataTransfer = start();
  const target = screen.getByRole('region', { name: 'Mover para a raiz da caixa' });
  fireEvent.dragOver(target, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe('move');
  fireEvent.drop(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(screen.getByRole('link', { name: 'Projetos' }));
  await screen.findByRole('status');
  const mutations = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(mutations).toEqual([
    ['/folders/child', { method: 'PATCH', body: { name: 'Projetos', parent_id: null } }],
  ]);
  expect(screen.getByRole('status')).toHaveTextContent('Aplicando no servidor');
  expect(screen.getByRole('button', { name: 'Opções da pasta Projetos' })).toBeDisabled();
});

it('invalidates folders only when the queued move finishes', async () => {
  const client = mount(),
    invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.mocked(api).mockImplementation(async (path, options) =>
    options?.method === 'PATCH'
      ? { action_id: 'action' }
      : path.startsWith('/folder-actions/')
        ? { status: 'done' }
        : [inbox],
  );
  const dataTransfer = start();
  fireEvent.drop(screen.getByRole('region', { name: 'Mover para a raiz da caixa' }), {
    dataTransfer,
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['folders'] }));
});

it('shows a worker failure without pretending the folder moved', async () => {
  mount();
  vi.mocked(api).mockImplementation(async (path, options) =>
    options?.method === 'PATCH'
      ? { action_id: 'action' }
      : path.startsWith('/folder-actions/')
        ? { status: 'failed', error: 'Não foi possível mover. Tente novamente.' }
        : [inbox],
  );
  const dataTransfer = start();
  fireEvent.drop(screen.getByRole('region', { name: 'Mover para a raiz da caixa' }), {
    dataTransfer,
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Tente novamente');
});

it('rejects cross-mailbox drops and never nests on a folder row', async () => {
  mount();
  const dataTransfer = start();
  fireEvent.drop(screen.getByRole('link', { name: 'Caixa de entrada' }), { dataTransfer });
  writeMailDrag(dataTransfer, {
    kind: 'folder',
    id: 'child',
    parentId: 'inbox',
    mailboxId: 'other',
  });
  fireEvent.drop(screen.getByRole('region', { name: 'Mover para a raiz da caixa' }), {
    dataTransfer,
  });
  expect(
    vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'PATCH'),
  ).toHaveLength(0);
});

it('does not offer a root move without organize permission', () => {
  mount(false);
  start();
  expect(
    screen.queryByRole('region', { name: 'Mover para a raiz da caixa' }),
  ).not.toBeInTheDocument();
});

it('keeps enqueue errors visible and permits retrying the drop', async () => {
  mount();
  vi.mocked(api).mockRejectedValueOnce(Error('Servidor indisponível.'));
  const dataTransfer = start();
  const target = screen.getByRole('region', { name: 'Mover para a raiz da caixa' });
  fireEvent.drop(target, { dataTransfer });
  expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível');
  fireEvent.drop(target, { dataTransfer });
  expect(await screen.findByRole('status')).toHaveTextContent('Aplicando no servidor');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
