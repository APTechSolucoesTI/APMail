import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Folder } from '@/lib/mail';
import { api } from '@/lib/api';
import { FolderDestinationPicker, type FolderDestination } from './folder-destination-picker';

vi.mock('@/lib/auth', () => ({
  useTenantId: () => 'tenant',
  canMailbox: (box: { role?: string }) => box.role !== 'viewer',
}));
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => []) }));
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
  name: 'Contratos',
  parent_id: 'parent',
  children: [],
  special_use: null,
  unread_count: 0,
};
const folders: Folder[] = [
  {
    id: 'parent',
    name: 'Clientes',
    parent_id: null,
    children: [child],
    special_use: null,
    unread_count: 0,
  },
];
function open(excludeIds?: Set<string>, allowMailboxChange = false) {
  function Fixture() {
    const [value, setValue] = useState<FolderDestination | null>(null);
    return (
      <>
        <FolderDestinationPicker
          mailboxId="box"
          folders={folders}
          value={value}
          onChange={setValue}
          allowRoot
          allowMailboxChange={allowMailboxChange}
          excludeIds={excludeIds}
        />
        <output>{value?.path}</output>
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Fixture />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Pasta de destino' }));
}
it('navigates through children, shows breadcrumbs and confirms current folder', () => {
  open();
  expect(screen.queryByRole('option', { name: /Contratos/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /Clientes/ }));
  fireEvent.click(screen.getByRole('option', { name: /Contratos/ }));
  expect(screen.getByRole('navigation', { name: 'Caminho da pasta' })).toHaveTextContent(
    'Clientes',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar esta pasta' }));
  expect(screen.getByRole('status')).toHaveTextContent('Clientes / Contratos');
});
it('searches complete paths and blocks excluded folders', () => {
  open(new Set(['child']));
  fireEvent.change(screen.getByPlaceholderText('Buscar em todas as pastas…'), {
    target: { value: 'clientes contratos' },
  });
  expect(screen.queryByRole('option', { name: /Contratos/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Buscar em todas as pastas…'), {
    target: { value: 'clientes' },
  });
  expect(screen.getByRole('option', { name: /Clientes/ })).toBeVisible();
});
it('selects another authorized mailbox and fetches its folder hierarchy', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/mailboxes'
      ? [
          { id: 'other', name: 'Financeiro', email_address: 'financeiro@test', role: 'editor' },
          { id: 'denied', name: 'Restrita', email_address: 'restrita@test', role: 'viewer' },
        ]
      : [{ ...child, parent_id: null }],
  );
  open(undefined, true);
  fireEvent.click(screen.getByRole('button', { name: 'Trocar caixa' }));
  expect(await screen.findByRole('option', { name: /Financeiro/ })).toBeVisible();
  expect(screen.queryByRole('option', { name: /Restrita/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /Financeiro/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Contratos' }));
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar esta pasta' }));
  expect(screen.getByRole('status')).toHaveTextContent('Financeiro / Contratos');
  expect(api).toHaveBeenCalledWith(
    '/mailboxes/other/folders',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
