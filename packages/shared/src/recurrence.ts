import { z } from 'zod';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
export const recurrenceSchema = z.object({
  unit: z.enum(['hour', 'day', 'week', 'month']),
  interval: z.number().int().min(1).max(365),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Fuso horário inválido.'),
  end_at: z.iso.datetime().optional(),
  max_occurrences: z.number().int().min(1).max(10000).optional(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type SendSchedule = { scheduled_at: string; recurrence?: Recurrence };
const parts = (date: Date, timezone: string) =>
  formatInTimeZone(date, timezone, 'yyyy-MM-dd').split('-').map(Number) as [number, number, number];
export function recurrenceOccurrence(starts: Date, recurrence: Recurrence, index: number): Date {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Ocorrência inválida.');
  if (recurrence.unit === 'hour')
    return new Date(starts.getTime() + index * recurrence.interval * 3600000);
  const [year, month, day] = parts(starts, recurrence.timezone);
  let calendar: Date;
  if (recurrence.unit === 'month') {
    const target = new Date(Date.UTC(year, month - 1 + index * recurrence.interval, 1, 12));
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    calendar = target;
  } else
    calendar = new Date(
      Date.UTC(
        year,
        month - 1,
        day + index * recurrence.interval * (recurrence.unit === 'week' ? 7 : 1),
        12,
      ),
    );
  const time = formatInTimeZone(starts, recurrence.timezone, 'HH:mm:ss.SSS');
  return fromZonedTime(calendar.toISOString().slice(0, 10) + 'T' + time, recurrence.timezone);
}
/** Preserve the original local calendar/time and skip missed slots after downtime. */
export function nextRecurrence(starts: Date, recurrence: Recurrence, after: Date): Date | null {
  let index: number;
  if (recurrence.unit === 'hour')
    index = Math.max(
      1,
      Math.floor((after.getTime() - starts.getTime()) / (recurrence.interval * 3600000)),
    );
  else {
    const start = parts(starts, recurrence.timezone),
      end = parts(after, recurrence.timezone);
    const distance =
      recurrence.unit === 'month'
        ? (end[0] - start[0]) * 12 + end[1] - start[1]
        : (Date.UTC(end[0], end[1] - 1, end[2]) - Date.UTC(start[0], start[1] - 1, start[2])) /
          86400000;
    index = Math.max(
      1,
      Math.floor(distance / (recurrence.interval * (recurrence.unit === 'week' ? 7 : 1))),
    );
  }
  let next = recurrenceOccurrence(starts, recurrence, index);
  while (next.getTime() <= after.getTime())
    next = recurrenceOccurrence(starts, recurrence, ++index);
  return recurrence.end_at && next > new Date(recurrence.end_at) ? null : next;
}
export const RECURRENCE_UNITS: Record<Recurrence['unit'], string> = {
  hour: 'hora(s)',
  day: 'dia(s)',
  week: 'semana(s)',
  month: 'mês(es)',
};
export function recurrenceLabel(recurrence: Pick<Recurrence, 'unit' | 'interval'>) {
  const words = {
    hour: ['hora', 'horas'],
    day: ['dia', 'dias'],
    week: ['semana', 'semanas'],
    month: ['mês', 'meses'],
  };
  return recurrence.interval === 1
    ? `A cada ${words[recurrence.unit][0]}`
    : `A cada ${recurrence.interval} ${words[recurrence.unit][1]}`;
}
