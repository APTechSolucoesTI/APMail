import { z } from 'zod';

export const WEEK_DAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const;
const startTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Informe um horário válido.');
const endTime = z
  .string()
  .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Informe um horário válido.');
export const accessIntervalsSchema = z
  .array(z.object({ start: startTime, end: endTime }))
  .max(4)
  .superRefine((items, ctx) => {
    for (const [i, item] of items.entries()) {
      if (item.start >= item.end)
        ctx.addIssue({
          code: 'custom',
          path: [i, 'end'],
          message:
            'O fim deve ser depois do início. Para turnos noturnos, configure cada dia separadamente.',
        });
      if (items.some((other, j) => j < i && item.start < other.end && item.end > other.start))
        ctx.addIssue({
          code: 'custom',
          path: [i, 'start'],
          message: 'Os intervalos não podem se sobrepor.',
        });
    }
  });
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');
export const accessScheduleSchema = z
  .object({
    enabled: z.boolean(),
    weekly: z.array(accessIntervalsSchema).length(7),
    exceptions: z
      .array(
        z.object({
          date: dateSchema,
          intervals: accessIntervalsSchema,
          reason: z.string().trim().max(160),
        }),
      )
      .max(500),
  })
  .superRefine((value, ctx) => {
    // JSON escapes lone surrogates; percent encoding counts UTF-8 bytes in either runtime.
    if (
      encodeURIComponent(JSON.stringify(value, null, 1)).replace(/%[0-9A-F]{2}/g, 'x').length >
      262144
    )
      ctx.addIssue({
        code: 'custom',
        path: ['exceptions'],
        message: 'A lista de exceções é muito extensa. Reduza os motivos ou remova datas antigas.',
      });
    const dates = new Set<string>();
    for (const [i, item] of value.exceptions.entries()) {
      if (dates.has(item.date))
        ctx.addIssue({
          code: 'custom',
          path: ['exceptions', i, 'date'],
          message: 'Já existe uma exceção para esta data.',
        });
      dates.add(item.date);
    }
  });
export type AccessSchedule = z.infer<typeof accessScheduleSchema>;
export type AccessInterval = AccessSchedule['weekly'][number][number];
export const defaultAccessSchedule = (): AccessSchedule => ({
  enabled: false,
  weekly: Array.from({ length: 7 }, (_, day) =>
    day > 0 && day < 6 ? [{ start: '08:00', end: '17:00' }] : [],
  ),
  exceptions: [],
});

/** Calendar dates and clock times always belong to the company's timezone. End is exclusive. */
export function isWithinAccessSchedule(
  value: unknown,
  timezone: string,
  now = new Date(),
): boolean {
  if (value == null) return true;
  const parsed = accessScheduleSchema.safeParse(value);
  if (!parsed.success) return false;
  if (!parsed.data.enabled) return true;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const clock = `${part('hour')}:${part('minute')}`;
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  const intervals =
    parsed.data.exceptions.find((item) => item.date === date)?.intervals ??
    parsed.data.weekly[day]!;
  return intervals.some((item) => clock >= item.start && clock < item.end);
}
