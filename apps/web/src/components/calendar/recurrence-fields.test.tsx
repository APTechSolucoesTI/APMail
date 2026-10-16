import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect } from 'vitest';
import { RecurrenceFields } from './recurrence-fields';
function Form() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <RecurrenceFields value={value} onChange={setValue} timezone="America/Sao_Paulo" />
      <output aria-label="Recorrência">{value}</output>
    </>
  );
}
it('configura semanas alternadas e dias escolhidos sem exigir sintaxe de calendário', () => {
  render(<Form />);
  fireEvent.change(screen.getByLabelText('Repetir'), { target: { value: 'WEEKLY' } });
  fireEvent.change(screen.getByLabelText('Intervalo da repetição'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Repetir na Seg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Repetir na Qua' }));
  fireEvent.change(screen.getByLabelText('Fim da repetição'), { target: { value: 'count' } });
  expect(screen.getByLabelText('Recorrência')).toHaveTextContent(
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10',
  );
});
it('permite repetir na última sexta-feira de cada mês', () => {
  render(<Form />);
  fireEvent.change(screen.getByLabelText('Repetir'), { target: { value: 'MONTHLY' } });
  fireEvent.change(screen.getByLabelText('Padrão mensal'), { target: { value: 'weekday' } });
  fireEvent.change(screen.getByLabelText('Semana do mês'), { target: { value: '-1' } });
  fireEvent.change(screen.getByLabelText('Dia da semana'), { target: { value: 'FR' } });
  expect(screen.getByLabelText('Recorrência')).toHaveTextContent('FREQ=MONTHLY;BYDAY=-1FR');
});
it('converte a data final no fuso do compromisso', () => {
  render(<Form />);
  fireEvent.change(screen.getByLabelText('Repetir'), { target: { value: 'DAILY' } });
  fireEvent.change(screen.getByLabelText('Fim da repetição'), { target: { value: 'date' } });
  fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-30' } });
  expect(screen.getByLabelText('Recorrência')).toHaveTextContent('UNTIL=20261031T025900Z');
});
