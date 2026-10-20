import { it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { normalizeTime, DateTimeField } from './date-time-field';
import { EventSchedule } from './event-schedule';
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => vi.unstubAllGlobals());
it('aceita horários digitados e rejeita horários impossíveis', () => {
  expect(normalizeTime('930')).toBe('09:30');
  expect(normalizeTime('9:07')).toBe('09:07');
  expect(normalizeTime('24:00')).toBeNull();
  expect(normalizeTime('12:90')).toBeNull();
});
it('permite escolher um horário personalizado sem o seletor nativo', () => {
  function Form() {
    const [value, setValue] = useState('2026-10-16T09:00');
    return <DateTimeField label="Início" value={value} onChange={setValue} />;
  }
  render(<Form />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Horário de início' }));
  fireEvent.change(screen.getByLabelText('Pesquisar horário de início'), {
    target: { value: '9:07' },
  });
  fireEvent.click(screen.getByText('Usar 09:07'));
  expect(screen.getByRole('combobox', { name: 'Horário de início' }).textContent).toContain(
    '09:07',
  );
});
it('mantém a duração ao alterar início e aplica duração escolhida', () => {
  function Form() {
    const [range, setRange] = useState(['2026-10-16T09:00', '2026-10-16T10:00']);
    return (
      <EventSchedule
        start={range[0]!}
        end={range[1]!}
        onChange={(a, b) => setRange([a, b])}
        timezone="America/Sao_Paulo"
        allDay={false}
        onAllDayChange={() => {}}
      />
    );
  }
  render(<Form />);
  fireEvent.change(screen.getByLabelText('Duração'), { target: { value: '30' } });
  expect(screen.getByRole('combobox', { name: 'Horário de término' }).textContent).toContain(
    '09:30',
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Horário de início' }));
  fireEvent.click(screen.getByText('11:00'));
  expect(screen.getByRole('combobox', { name: 'Horário de término' }).textContent).toContain(
    '11:30',
  );
});
it('dia inteiro apresenta o último dia incluído e mantém término exclusivo no envio', () => {
  function Form() {
    const [range, setRange] = useState(['2026-10-16T09:00', '2026-10-16T10:00']),
      [allDay, setAllDay] = useState(false);
    return (
      <>
        <EventSchedule
          start={range[0]!}
          end={range[1]!}
          onChange={(a, b) => setRange([a, b])}
          timezone="America/Sao_Paulo"
          allDay={allDay}
          onAllDayChange={setAllDay}
        />
        <output>{range.join('|')}</output>
      </>
    );
  }
  render(<Form />);
  fireEvent.click(screen.getByLabelText('Dia inteiro'));
  expect(screen.getByRole('status').textContent).toBe('2026-10-16T00:00|2026-10-17T00:00');
  expect(screen.getByRole('button', { name: 'Data de término' }).textContent).toContain(
    '16 de out',
  );
  expect(screen.queryByRole('combobox', { name: 'Horário de início' })).toBeNull();
});

it('período opcional exige escolher uma data antes do horário', () => {
  const onChange = vi.fn();
  render(<DateTimeField label="Início" value="" onChange={onChange} />);
  expect(screen.getByRole('combobox', { name: 'Horário de início' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Data de início' })).toBeEnabled();
  expect(onChange).not.toHaveBeenCalled();
});
