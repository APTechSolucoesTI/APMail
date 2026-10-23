import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { CompanySettings } from './company-settings';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock('@/lib/auth', () => ({ useTenantId: () => 'tenant', useAccess: () => true }));
vi.mock('@/components/storage/storage-quotas', () => ({
  TenantStorage: () => <p>Armazenamento da empresa</p>,
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const registration = {
  name: 'Empresa QA',
  timezone: 'America/Sao_Paulo',
  company_details: { city: 'Campinas' },
  settings: {
    contact_mode: 'tenant',
    max_attachment_mb: 20,
    default_sync_days: 90,
    sla_first_response_hours: 8,
    allow_external_auto_forward: false,
    default_invitation_mailbox_id: null,
  },
};
function setup() {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) => (path === '/tenant' ? registration : []));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CompanySettings />
    </QueryClientProvider>,
  );
}
it('separates registration, operations and storage without losing unsaved registration edits', async () => {
  setup();
  await screen.findByRole('tab', { name: 'Cadastro' });
  fireEvent.change(screen.getByLabelText('Nome da empresa'), {
    target: { value: 'Nome em edição' },
  });
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'E-mail e contatos' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByLabelText('Modo de novos contatos')).toBeVisible();
  expect(screen.getByLabelText('CNPJ')).not.toBeVisible();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Armazenamento' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByText('Armazenamento da empresa')).toBeVisible();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Cadastro' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByLabelText('Nome da empresa')).toHaveValue('Nome em edição');
});
it('saves only the settings from the chosen operational section', async () => {
  setup();
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'E-mail e contatos' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.change(screen.getByLabelText('Modo de novos contatos'), {
    target: { value: 'personal' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contatos' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/tenant', {
      method: 'PATCH',
      body: { settings: { contact_mode: 'personal' } },
    }),
  );
});
it('saves the import period as a number without overwriting other settings', async () => {
  setup();
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'E-mail e contatos' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.change(screen.getByLabelText('Período de importação inicial'), {
    target: { value: '365' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar atendimento' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/tenant', {
      method: 'PATCH',
      body: { settings: { sla_first_response_hours: 8, default_sync_days: 365 } },
    }),
  );
});
