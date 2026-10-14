import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ScheduleDialog } from './schedule-dialog';
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);
it('envia a primeira data com o intervalo e a quantidade de ocorrências escolhidos', () => {
  const onSchedule = vi.fn();
  render(
    <ScheduleDialog
      open
      onClose={() => undefined}
      onSchedule={onSchedule}
      timezone="America/Sao_Paulo"
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Repetir este envio' }));
  fireEvent.change(screen.getByLabelText('A cada'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'day' } });
  fireEvent.change(screen.getByLabelText('Terminar'), { target: { value: 'count' } });
  fireEvent.change(screen.getByLabelText('Total de envios, incluindo o primeiro'), {
    target: { value: '4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Amanhã às 08:00' }));
  expect(onSchedule.mock.calls[0]?.[0]).toMatchObject({
    scheduled_at: expect.any(String),
    recurrence: { unit: 'day', interval: 2, timezone: 'America/Sao_Paulo', max_occurrences: 4 },
  });
});
it('não agenda uma recorrência sem a data de término escolhida', () => {
  const onSchedule = vi.fn();
  render(
    <ScheduleDialog
      open
      onClose={() => undefined}
      onSchedule={onSchedule}
      timezone="America/Sao_Paulo"
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Repetir este envio' }));
  fireEvent.change(screen.getByLabelText('Terminar'), { target: { value: 'date' } });
  fireEvent.click(screen.getByRole('button', { name: 'Amanhã às 08:00' }));
  expect(onSchedule.mock.calls).toHaveLength(0);
  expect(screen.getByRole('alert')).toHaveTextContent('Escolha a data de término');
});
