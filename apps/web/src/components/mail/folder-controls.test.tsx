import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderControls } from './folder-controls';
import type { Folder } from '@/lib/mail';
const mocks = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));
vi.mock('@/lib/auth', () => ({ useTenantId: () => 'tenant' }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();
const child: Folder = {
  id: 'child',
  name: 'Filha',
  parent_id: 'source',
  special_use: null,
  unread_count: 0,
  children: [],
};
const source: Folder = {
  id: 'source',
  name: 'Origem',
  parent_id: null,
  special_use: null,
  unread_count: 0,
  children: [child],
};
const destination: Folder = {
  id: 'destination',
  name: 'Destino',
  parent_id: null,
  special_use: null,
  unread_count: 0,
  children: [],
};
function mount(activeFolder = source, folders = [source, destination]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.api.mockImplementation(async (path: string, options?: { method?: string }) =>
    options?.method === 'PATCH'
      ? { action_id: 'action' }
      : path.startsWith('/folder-actions/')
        ? { status: 'processing' }
        : folders,
  );
  render(
    <QueryClientProvider client={client}>
      <FolderControls mailboxId="box" folder={activeFolder}>
        <span>Origem</span>
      </FolderControls>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});
async function openMove() {
  fireEvent.contextMenu(screen.getByText('Origem'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Mover para…' }));
  await screen.findByLabelText('Pasta de destino');
}
function chooseDestination() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Pasta de destino' }));
  fireEvent.click(screen.getByRole('option', { name: 'Destino' }));
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar esta pasta' }));
}
it('offers explicit hierarchy change with descendants excluded and same-parent move disabled', async () => {
  mount();
  await openMove();
  expect(screen.queryByRole('option', { name: 'Filha' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Origem' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mover pasta' })).toBeDisabled();
  chooseDestination();
  fireEvent.click(screen.getByRole('button', { name: 'Mover pasta' }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      '/folders/source',
      expect.objectContaining({
        method: 'PATCH',
        body: { name: 'Origem', parent_id: 'destination' },
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('Aplicando');
  expect(mocks.success).not.toHaveBeenCalled();
});
it('shows the current remote parent for an imported local folder but excludes new mixed destinations', async () => {
  const imported = { ...source, is_local: true, parent_id: 'inbox' };
  const inbox = {
    ...destination,
    id: 'inbox',
    name: 'Inbox',
    is_local: false,
    children: [imported],
  };
  const otherRemote = { ...destination, id: 'remote', name: 'Remote', is_local: false };
  const localTarget = { ...destination, id: 'local', name: 'Local', is_local: true };
  mount(imported, [inbox, otherRemote, localTarget]);
  await openMove();
  expect(screen.getByLabelText('Pasta de destino')).toHaveTextContent('Inbox');
  fireEvent.click(screen.getByRole('combobox', { name: 'Pasta de destino' }));
  fireEvent.click(screen.getByRole('button', { name: 'Raiz' }));
  expect(screen.getByRole('option', { name: 'Local' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Remote' }));
  expect(screen.getByRole('button', { name: 'Selecionar esta pasta' })).toBeDisabled();
  fireEvent.keyDown(screen.getByPlaceholderText('Buscar em todas as pastas…'), { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Mover pasta' })).toBeDisabled();
});
it('waits for the target parent instead of falsely completing when the name is unchanged', async () => {
  mount();
  await openMove();
  chooseDestination();
  fireEvent.click(screen.getByRole('button', { name: 'Mover pasta' }));
  await screen.findByRole('status');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(mocks.success).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Opções da pasta Origem' })).toBeDisabled();
  fireEvent.contextMenu(screen.getByText('Origem'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
it('keeps the dialog and shows a retryable server error when enqueueing fails', async () => {
  mount();
  await openMove();
  mocks.api.mockRejectedValueOnce(Error('Destino indisponível.'));
  chooseDestination();
  fireEvent.click(screen.getByRole('button', { name: 'Mover pasta' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Destino indisponível');
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Mover pasta' })).toBeEnabled();
});
it('recovers asynchronous failure from polling when the socket event was missed', async () => {
  mount();
  await openMove();
  mocks.api.mockImplementation(async (path: string, options?: { method?: string }) =>
    options?.method === 'PATCH'
      ? { action_id: 'action' }
      : path.startsWith('/folder-actions/')
        ? { status: 'failed', error: 'A pasta de destino mudou. Tente novamente.' }
        : [source, destination],
  );
  chooseDestination();
  fireEvent.click(screen.getByRole('button', { name: 'Mover pasta' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('destino mudou');
  expect(screen.getByRole('button', { name: 'Opções da pasta Origem' })).toBeEnabled();
  expect(mocks.success).not.toHaveBeenCalled();
});
it('polls completion and invalidates the folder cache after a successful operation', async () => {
  const client = mount(),
    invalidate = vi.spyOn(client, 'invalidateQueries');
  await openMove();
  mocks.api.mockImplementation(async (path: string, options?: { method?: string }) =>
    options?.method === 'PATCH'
      ? { action_id: 'action' }
      : path.startsWith('/folder-actions/')
        ? { status: 'done' }
        : [source, destination],
  );
  chooseDestination();
  fireEvent.click(screen.getByRole('button', { name: 'Mover pasta' }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['folders'] });
});
