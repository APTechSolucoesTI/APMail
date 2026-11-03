import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Address } from '@apmail/shared';
import { api } from '@/lib/api';
import { EmailChipInput } from './email-chip-input';
const permissions = vi.hoisted(() => ({ write: true, read: true }));
vi.mock('@/lib/auth', () => ({
  useTenantId: () => 'tenant',
  useUserId: () => 'user',
  useAccess: (permission: string) =>
    permission === 'contacts' ? permissions.read : permissions.write,
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
const maria = {
  id: 'maria',
  name: 'Maria Silva',
  scope: 'tenant',
  company: 'APTech',
  emails: ['maria@empresa.com', 'maria.pessoal@example.com'],
};
let saved: { path?: string; body?: unknown };
beforeEach(() => {
  permissions.write = true;
  permissions.read = true;
  saved = {};
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path, options) => {
      if (path === '/contacts/resolve') return { contacts: {} };
      if (options?.method === 'POST') {
        saved = { path, body: options.body };
        return { id: 'new' };
      }
      if (path?.startsWith('/contacts?'))
        return { items: [maria], total: 1, page: 1, pageSize: 20 };
      return [];
    });
});
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Fixture() {
    const [value, setValue] = useState<Address[]>([]);
    return <EmailChipInput label="Para" value={value} onChange={setValue} mailboxId="box" />;
  }
  return render(
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>,
  );
}
it('abre agenda pelo rótulo e seleciona vários endereços do mesmo contato', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Para' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /maria@empresa.com/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /maria.pessoal@example.com/ }));
  fireEvent.click(screen.getByRole('button', { name: /Adicionar destinatários/ }));
  expect(screen.getByRole('button', { name: 'Remover maria@empresa.com' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Remover maria.pessoal@example.com' })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('cria um contato na agenda e usa o endereço imediatamente', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Para' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Novo contato' }));
  fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Joana Costa' } });
  fireEvent.change(screen.getByLabelText('E-mail do contato'), {
    target: { value: 'joana@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar e usar endereço' }));
  expect(await screen.findByRole('button', { name: 'Remover joana@example.com' })).toBeVisible();
  expect(saved.path).toBe('/contacts/from-message');
  expect(saved.body).toMatchObject({
    name: 'Joana Costa',
    emails: [{ email: 'joana@example.com', is_primary: true }],
  });
});
it('adiciona endereço ao contato existente preservando os anteriores e usa no destinatário', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Para' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar e-mail a Maria Silva' }));
  fireEvent.change(screen.getByLabelText('E-mail do contato'), {
    target: { value: 'novo@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar e usar endereço' }));
  expect(await screen.findByRole('button', { name: 'Remover novo@example.com' })).toBeVisible();
  expect(saved).toEqual({ path: '/contacts/maria/emails', body: { email: 'novo@example.com' } });
});
it('consulta agenda sem expor ações de escrita a quem não tem permissão', async () => {
  permissions.write = false;
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Para' }));
  expect(await screen.findByRole('checkbox', { name: /maria@empresa.com/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Novo contato' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Adicionar e-mail a/ })).not.toBeInTheDocument();
});
it('preserva o formulário e não usa o endereço quando salvar falha', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/contacts/resolve') return { contacts: {} };
    if (path === '/contacts/from-message') throw new Error('Não foi possível salvar.');
    return { items: [], total: 0 };
  });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Para' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Novo contato' }));
  fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Joana Costa' } });
  fireEvent.change(screen.getByLabelText('E-mail do contato'), {
    target: { value: 'joana@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar e usar endereço' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.');
  expect(screen.getByLabelText('E-mail do contato')).toHaveValue('joana@example.com');
  expect(
    screen.queryByRole('button', { name: 'Remover joana@example.com' }),
  ).not.toBeInTheDocument();
});
it('não abre agenda sem permissão, mantendo digitação manual disponível', () => {
  permissions.read = false;
  open();
  expect(screen.queryByRole('button', { name: 'Para' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Para' })).toBeVisible();
});
it('busca outra página no servidor e mantém a seleção entre páginas', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/contacts/resolve') return { contacts: {} };
    if (path?.startsWith('/contacts?')) {
      const secondPage = new URLSearchParams(path.split('?')[1]).get('page') === '2';
      return {
        items: secondPage
          ? [{ ...maria, id: 'other', name: 'Outro contato', emails: ['outro@example.com'] }]
          : [maria],
        total: 21,
      };
    }
    return [];
  });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Para' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /maria@empresa.com/ }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Próxima página de contatos' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Próxima página de contatos' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /outro@example.com/ }));
  fireEvent.click(screen.getByRole('button', { name: /Adicionar destinatários/ }));
  expect(screen.getByRole('button', { name: 'Remover maria@empresa.com' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Remover outro@example.com' })).toBeVisible();
});
