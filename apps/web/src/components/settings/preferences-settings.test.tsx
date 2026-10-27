import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesSettings } from './preferences-settings';
import { api } from '@/lib/api';

const original = {
  theme: 'light',
  density: 'compact',
  timezone: 'America/Sao_Paulo',
  mail_queues_enabled: true,
  mail_summary_enabled: false,
  mail_page_size: 10,
  request_read_receipt: false,
  load_remote_images: false,
  notify_chat: true,
  notify_mentions: true,
  notify_assignments: true,
  desktop_notifications: false,
};
let preferences = { ...original };
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock('@/lib/auth', () => ({
  meQuery: { queryKey: ['me'], queryFn: async () => ({ preferences }) },
}));
beforeEach(() => {
  preferences = { ...original };
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (_path, options) => {
    preferences = { ...preferences, ...(options?.body as Partial<typeof original>) };
    return preferences;
  });
});
it('prioriza tema e fuso; salvar uma aba não sobrescreve preferências das demais', async () => {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PreferencesSettings />
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText('Tema')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Fuso horário' })).toBeVisible();
  expect(screen.queryByRole('checkbox', { name: /Usar filas/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'E-mail' }));
  expect(screen.queryByRole('checkbox', { name: /Usar filas/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /Deseja utilizar o Resumo/ }));
  await user.selectOptions(screen.getByLabelText('E-mails por página'), '25');
  await user.click(screen.getByRole('checkbox', { name: /Solicitar confirmação/ }));
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/preferences', {
      method: 'PUT',
      body: {
        mail_summary_enabled: true,
        mail_page_size: 25,
        request_read_receipt: true,
        load_remote_images: false,
        density: 'compact',
      },
    }),
  );
  await user.click(screen.getByRole('tab', { name: 'Notificações' }));
  await user.click(screen.getByRole('checkbox', { name: /Notificar mensagens do chat/ }));
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(preferences.notify_chat).toBe(false));
  expect(preferences).toMatchObject({
    theme: 'light',
    timezone: 'America/Sao_Paulo',
    mail_queues_enabled: true,
    mail_summary_enabled: true,
    mail_page_size: 25,
    request_read_receipt: true,
  });
});
