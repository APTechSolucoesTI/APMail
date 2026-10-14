import { beforeEach, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { ContactAssociationDialog } from './contact-association-dialog';
vi.mock('@/lib/auth', () => ({ useTenantId: () => 'tenant', useUserId: () => 'user' }));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
const contact = {
  id: 'person',
  name: 'João da Silva',
  emails: ['joao@empresa.com'],
  scope: 'tenant',
  company: 'Empresa',
};
beforeEach(() => {
  vi.mocked(api).mockReset();
});
const open = (
  addresses = [{ address: 'novo@empresa.com', name: 'Nome SMTP' }],
  afterSend = true,
) => {
  const closed = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContactAssociationDialog addresses={addresses} afterSend={afterSend} onClose={closed} />
    </QueryClientProvider>,
  );
  return closed;
};
it('recusa depois do envio encerra sem criar, vincular ou repetir envio', () => {
  const close = open();
  expect(screen.getByText('Destinatário não cadastrado')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Não, obrigado' }));
  expect(close).toHaveBeenCalledOnce();
  expect(api).not.toHaveBeenCalled();
});
it('aceita, corrige nome sugerido e cria pela mesma API da mensagem', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/contacts/resolve' ? { contacts: {} } : { id: 'new' },
  );
  const close = open();
  fireEvent.click(screen.getByRole('button', { name: 'Sim, adicionar' }));
  fireEvent.click(screen.getByRole('button', { name: /Criar novo contato/ }));
  expect(screen.getByLabelText('E-mail')).toHaveValue('novo@empresa.com');
  expect(screen.getByLabelText('Nome completo')).toHaveValue('Nome SMTP');
  fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Maria Souza' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contato' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(
    '/contacts/from-message',
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        name: 'Maria Souza',
        emails: [{ email: 'novo@empresa.com', label: '', is_primary: true }],
      }),
    }),
  );
});
it('pesquisa e vincula sem enviar uma substituição dos e-mails antigos', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith('/contacts?')
      ? { items: [contact], total: 1 }
      : path === '/contacts/resolve'
        ? { contacts: {} }
        : { id: contact.id },
  );
  const close = open(undefined, false);
  fireEvent.click(screen.getByRole('button', { name: /Vincular a contato existente/ }));
  const option = await screen.findByRole('radio');
  fireEvent.click(option);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith('/contacts/person/emails', {
    method: 'POST',
    body: { email: 'novo@empresa.com' },
  });
  expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
});
it('erro no cadastro mantém o diálogo e informa que o envio já foi concluído', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/contacts/resolve') return { contacts: {} };
    throw new Error('Já existe um contato.');
  });
  const close = open();
  fireEvent.click(screen.getByRole('button', { name: 'Sim, adicionar' }));
  fireEvent.click(screen.getByRole('button', { name: /Criar novo contato/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contato' }));
  expect(await screen.findByText('Já existe um contato. O e-mail já foi enviado.')).toBeVisible();
  expect(close).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(2);
});
it('deduplica endereços e pula os vínculos realizados durante o fluxo', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/contacts/resolve'
      ? { contacts: { 'other@empresa.com': contact } }
      : { id: contact.id },
  );
  const close = open(
    [
      { address: 'new@empresa.com', name: 'Maria' },
      { address: 'NEW@empresa.com', name: '' },
      { address: 'other@empresa.com', name: '' },
    ],
    false,
  );
  expect(screen.getByText('Endereço 1 de 2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Criar novo contato/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contato' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith('/contacts/resolve', {
    method: 'POST',
    body: { emails: ['other@empresa.com'] },
  });
});
