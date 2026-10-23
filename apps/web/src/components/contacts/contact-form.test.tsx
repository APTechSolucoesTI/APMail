import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { contactSchema, type ContactDetail } from '@apmail/shared';
import { ContactEditorDialog } from './contact-form';
import { api } from '@/lib/api';
import { TenantContext } from '@/lib/auth';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('./contact-history', () => ({ ContactHistory: () => null }));
vi.mock('./contact-send', () => ({ ContactSendDialog: () => null }));
const contact: ContactDetail = {
  ...contactSchema.parse({
    name: 'Ana Souza',
    company: 'Empresa Exemplo',
    notes: 'Responsável pelo financeiro.',
    emails: [{ email: 'ana@example.com', is_primary: true }],
  }),
  id: 'contact',
  scope: 'tenant',
  owner_user_id: null,
  version: 1,
  created_at: '2026-10-22T12:00:00Z',
  updated_at: '2026-10-22T12:00:00Z',
  created_by_name: 'Gabriel',
  updated_by_name: 'Gabriel',
};
function setup(permissions: string[], id: string | undefined = 'contact') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me'], {
    user: { id: 'reader' },
    preferences: { timezone: 'America/Sao_Paulo' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'member', access_permissions: permissions }],
  });
  vi.mocked(api).mockImplementation(
    async (path) =>
      (path.startsWith('/contacts/suggestions')
        ? { items: [] }
        : path === '/contacts/mode'
          ? { mode: 'tenant' }
          : contact) as never,
  );
  render(
    <QueryClientProvider client={client}>
      <TenantContext value="tenant">
        <ContactEditorDialog id={id} onClose={() => undefined} />
      </TenantContext>
    </QueryClientProvider>,
  );
}
it('abre a ficha completa em consulta, sem controles para alterar ou salvar', async () => {
  setup(['contacts']);
  expect(await screen.findByText('Ana Souza')).toBeVisible();
  expect(screen.getByRole('dialog', { name: 'Consultar contato' })).toBeVisible();
  expect(screen.getByText('ana@example.com')).toBeVisible();
  expect(screen.getByText('Empresa Exemplo')).toBeVisible();
  expect(screen.getByText('Responsável pelo financeiro.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Salvar contato' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enviar novo e-mail' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
it('criar contatos não concede edição de registros existentes', async () => {
  setup(['contacts', 'contacts.create']);
  expect(await screen.findByRole('dialog', { name: 'Consultar contato' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Salvar contato' })).not.toBeInTheDocument();
});
