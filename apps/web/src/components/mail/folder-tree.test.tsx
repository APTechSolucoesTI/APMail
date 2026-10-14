import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { Folder } from '@/lib/mail';
import { FolderTree } from './folder-tree';
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to: _to,
    params,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params: { mailboxId: string };
    search: { folderId: string };
  }) => (
    <a data-to={_to} href={`/mail/${params.mailboxId}?folderId=${search.folderId}`} {...props}>
      {children}
    </a>
  ),
}));
const leaf: Folder = {
  id: 'leaf',
  name: 'Nome completo da pasta importada',
  parent_id: 'child',
  special_use: null,
  unread_count: 1234,
  children: [],
};
const child: Folder = {
  id: 'child',
  name: 'Projetos',
  parent_id: 'root',
  special_use: null,
  unread_count: 0,
  children: [leaf],
};
const root: Folder = {
  id: 'root',
  name: 'Importados',
  parent_id: null,
  special_use: null,
  unread_count: 0,
  children: [child],
};
function mount(activeId?: string, userId = 'user', mailboxId = 'box') {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], { user: { id: userId }, current_tenant_id: 'tenant' });
  return render(
    <QueryClientProvider client={client}>
      <FolderTree mailboxId={mailboxId} folders={[root]} activeId={activeId} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('starts collapsed, expands without navigation and preserves the user choice on remount', () => {
  const view = mount();
  expect(screen.queryByRole('link', { name: 'Projetos' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expandir Importados' }));
  expect(screen.getByRole('link', { name: 'Projetos' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Recolher Importados' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  view.unmount();
  mount();
  expect(screen.getByRole('link', { name: 'Projetos' })).toBeVisible();
});
it('opens active ancestors and exposes full names, path, unread count and keyboard collapse', () => {
  mount('leaf');
  const active = screen.getByRole('link', { name: leaf.name });
  expect(active).toHaveAttribute('title', `Importados / Projetos / ${leaf.name}`);
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(screen.getByLabelText('1234 não lidas')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('link', { name: 'Projetos' }), { key: 'ArrowLeft' });
  expect(screen.queryByRole('link', { name: leaf.name })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('link', { name: 'Projetos' }), { key: 'ArrowRight' });
  expect(screen.getByRole('link', { name: leaf.name })).toBeVisible();
});
it('isolates expanded folders by user and mailbox and tolerates invalid saved preferences', () => {
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Expandir Importados' }));
  view.unmount();
  const other = mount(undefined, 'other-user');
  expect(screen.queryByRole('link', { name: 'Projetos' })).not.toBeInTheDocument();
  other.unmount();
  localStorage.setItem('apmail-folders:user:tenant:another-box', 'invalid json');
  mount(undefined, 'user', 'another-box');
  expect(screen.getByRole('button', { name: 'Expandir Importados' })).toBeVisible();
});
it('reveals the selected folder even when its parents were previously saved as collapsed', () => {
  localStorage.setItem(
    'apmail-folders:user:tenant:box',
    JSON.stringify({ root: false, child: false }),
  );
  mount('leaf');
  expect(screen.getByRole('link', { name: leaf.name })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Recolher Importados' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
