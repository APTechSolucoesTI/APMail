import { expect, it } from 'vitest';
import { nextRecurrence, recurrenceOccurrence, recurrenceSchema } from '../src/recurrence.js';
const monthly = { unit: 'month' as const, interval: 1, timezone: 'America/Sao_Paulo' };
it('mantém o dia original no fim do mês sem deslocar março para o dia 28', () => {
  const start = new Date('2026-01-31T11:00:00Z');
  expect(recurrenceOccurrence(start, monthly, 1).toISOString()).toBe('2026-02-28T11:00:00.000Z');
  expect(nextRecurrence(start, monthly, new Date('2026-02-28T11:00:00Z'))?.toISOString()).toBe(
    '2026-03-31T11:00:00.000Z',
  );
});
it('preserva o horário local em mudanças de horário de verão', () => {
  expect(
    nextRecurrence(
      new Date('2026-03-07T13:00:00Z'),
      { unit: 'day', interval: 1, timezone: 'America/New_York' },
      new Date('2026-03-07T13:01:00Z'),
    )?.toISOString(),
  ).toBe('2026-03-08T12:00:00.000Z');
});
it('pula horários perdidos e respeita o término sem disparar uma sequência de atrasados', () => {
  const start = new Date('2026-10-14T12:00:00Z'),
    repeat = { unit: 'hour' as const, interval: 2, timezone: 'America/Sao_Paulo' };
  expect(nextRecurrence(start, repeat, new Date('2026-10-14T19:00:00Z'))?.toISOString()).toBe(
    '2026-10-14T20:00:00.000Z',
  );
  expect(
    nextRecurrence(
      start,
      { ...repeat, end_at: '2026-10-14T19:59:00Z' },
      new Date('2026-10-14T19:00:00Z'),
    ),
  ).toBeNull();
});
it('recusa fuso, intervalo ou quantidade inválidos', () => {
  expect(recurrenceSchema.safeParse({ ...monthly, interval: 0 }).success).toBe(false);
  expect(recurrenceSchema.safeParse({ ...monthly, timezone: 'inexistente' }).success).toBe(false);
  expect(recurrenceSchema.safeParse({ ...monthly, max_occurrences: 0 }).success).toBe(false);
});
