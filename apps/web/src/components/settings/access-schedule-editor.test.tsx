import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { defaultAccessSchedule } from '@apmail/shared';
import { AccessScheduleDialog } from './access-schedule-editor';
import { api } from '@/lib/api';
import { TenantContext } from '@/lib/auth';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
function setup() {
  vi.mocked(api).mockReset();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api).mockImplementation(async (_, options) =>
    options?.method === 'PUT'
      ? ({} as never)
      : ({ schedule: defaultAccessSchedule(), timezone: 'America/Sao_Paulo' } as never),
  );
  render(
    <QueryClientProvider client={client}>
      <TenantContext value="tenant">
        <AccessScheduleDialog
          user={{ user_id: 'operator', full_name: 'Ana Operadora' }}
          onClose={vi.fn()}
        />
      </TenantContext>
    </QueryClientProvider>,
  );
}
describe('Horário de acesso', () => {
  it('mantém acesso a qualquer horário e não exige preencher dias desativados', async () => {
    setup();
    const always = await screen.findByRole('switch', { name: 'Pode acessar a qualquer horário' });
    expect(always).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Segunda-feira, intervalo 1, início')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adicionar exceção' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário de acesso' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/members/operator/access-schedule',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({ enabled: false }),
        }),
      ),
    );
  });
  it('habilita semana, adiciona feriado e sábado extraordinário e salva a lista', async () => {
    setup();
    fireEvent.click(await screen.findByRole('switch', { name: 'Pode acessar a qualquer horário' }));
    expect(screen.getByLabelText('Segunda-feira, intervalo 1, início')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Segunda-feira, intervalo 1, início'), {
      target: { value: '09:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar exceção' }));
    fireEvent.change(screen.getByLabelText('Data da exceção 1'), {
      target: { value: '2026-11-02' },
    });
    fireEvent.change(screen.getByLabelText('Motivo da exceção 1'), {
      target: { value: 'Feriado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar exceção' }));
    fireEvent.change(screen.getByLabelText('Data da exceção 2'), {
      target: { value: '2026-11-07' },
    });
    fireEvent.click(screen.getAllByRole('switch', { name: 'Permitir expediente nesta data' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário de acesso' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/members/operator/access-schedule',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({
            enabled: true,
            exceptions: [
              { date: '2026-11-02', intervals: [], reason: 'Feriado' },
              { date: '2026-11-07', intervals: [{ start: '08:00', end: '17:00' }], reason: '' },
            ],
          }),
        }),
      ),
    );
  });
  it('preserva dados quando salvar falha e mostra erro de horário inválido', async () => {
    setup();
    fireEvent.click(await screen.findByRole('switch', { name: 'Pode acessar a qualquer horário' }));
    fireEvent.change(screen.getByLabelText('Segunda-feira, intervalo 1, fim'), {
      target: { value: '07:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário de acesso' }));
    expect(await screen.findByText(/O fim deve ser depois do início/)).toBeVisible();
    expect(
      vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'PUT'),
    ).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Segunda-feira, intervalo 1, fim'), {
      target: { value: '17:00' },
    });
    vi.mocked(api).mockRejectedValueOnce(Error('Falha temporária. Tente novamente.'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário de acesso' }));
    expect(await screen.findByText('Falha temporária. Tente novamente.')).toBeVisible();
    expect(
      within(screen.getByRole('dialog')).getByLabelText('Segunda-feira, intervalo 1, fim'),
    ).toHaveValue('17:00');
  });
});
