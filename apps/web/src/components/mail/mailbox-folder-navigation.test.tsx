import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MailboxFolderNavigation } from './mailbox-folder-navigation';
import { TenantContext, type Mailbox } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSocketRoom } from '@/hooks/use-socket-room';
const state = vi.hoisted(() => ({ pathname: '/mail/a', search: {} }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => state,
  Link: ({
    children,
    to: _to,
    params,
    search: _search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params: { mailboxId: string };
    search?: unknown;
  }) => (
    <a
      href={'/mail/' + params.mailboxId}
      data-to={_to}
      data-search={JSON.stringify(_search)}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/hooks/use-socket-room', () => ({ useSocketRoom: vi.fn() }));
vi.mock('./folder-controls', () => ({ FolderControls: () => null }));
const boxes = [
  { id: 'a', name: 'Comercial', role: 'viewer' },
  { id: 'b', name: 'Financeiro', role: 'viewer' },
] as Mailbox[];
function mount(user = 'user', tenant = 'tenant') {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['me'], {
    user: { id: user },
    current_tenant_id: tenant,
    preferences: { mail_queues_enabled: false },
  });
  return render(
    <QueryClientProvider client={client}>
      <TenantContext.Provider value={tenant}>
        {boxes.map((box) => (
          <MailboxFolderNavigation key={box.id} box={box} onNavigate={() => {}} />
        ))}
      </TenantContext.Provider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.pathname = '/mail/a';
  state.search = {};
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes('/folders')
      ? [
          {
            id: path.includes('/a/') ? 'inbox-a' : 'inbox-b',
            name: 'Entrada',
            special_use: 'inbox',
            parent_id: null,
            children: [],
            unread_count: 0,
          },
        ]
      : [],
  );
});
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
it('oferece Rascunhos na própria caixa mesmo quando o provedor não tem a pasta', async () => {
  state.search = { view: 'drafts' };
  mount();
  const drafts = await screen.findByRole('link', { name: 'Rascunhos' });
  expect(drafts).toHaveAttribute('data-search', JSON.stringify({ view: 'drafts' }));
  expect(drafts).toHaveAttribute('aria-current', 'page');
});
it('expande caixas independentemente e só busca pastas e ingressa em salas das abertas', async () => {
  mount();
  await screen.findByRole('link', { name: 'Caixa de entrada' });
  expect(api).not.toHaveBeenCalledWith('/mailboxes/b/folders');
  fireEvent.click(screen.getByRole('button', { name: 'Expandir Financeiro' }));
  await waitFor(() =>
    expect(screen.getAllByRole('link', { name: 'Caixa de entrada' })).toHaveLength(2),
  );
  expect(screen.getByRole('button', { name: 'Recolher Comercial' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(useSocketRoom).toHaveBeenCalledWith('mailbox', 'b');
  const entries = screen.getAllByRole('link', { name: 'Caixa de entrada' });
  expect(entries[0]).toHaveAttribute('aria-current', 'page');
  expect(entries[1]).not.toHaveAttribute('aria-current');
  fireEvent.click(screen.getByRole('button', { name: 'Recolher Comercial' }));
  expect(screen.getByRole('button', { name: 'Recolher Financeiro' })).toBeVisible();
});
it('persiste expansão por usuário, empresa e caixa e permite controle pelas setas', () => {
  const view = mount();
  const link = screen.getByRole('link', { name: 'Financeiro' });
  fireEvent.keyDown(link, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'Recolher Financeiro' })).toBeVisible();
  view.unmount();
  const saved = mount();
  expect(screen.getByRole('button', { name: 'Recolher Financeiro' })).toBeVisible();
  saved.unmount();
  const other = mount('other-user');
  expect(screen.getByRole('button', { name: 'Expandir Financeiro' })).toBeVisible();
  other.unmount();
  mount('user', 'other-tenant');
  expect(screen.getByRole('button', { name: 'Expandir Financeiro' })).toBeVisible();
});
