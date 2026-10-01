import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
export type SchedulePreset = { label: string; scheduled_at: string };
export function validateSchedule(value: string | Date, now = new Date()): Date {
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getTime() < now.getTime() + 300_000 ||
    date.getTime() > now.getTime() + 365 * 86_400_000
  )
    throw new Error('Agende entre 5 minutos e 365 dias a partir de agora.');
  return date;
}
export function schedulePresets(timezone: string, now = new Date()): SchedulePreset[] {
  const day = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const calendar = new Date(day + 'T12:00:00Z');
  const results: SchedulePreset[] = [];
  const at = (date: string, time: string) =>
    fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
  const today = at(day, '14:00');
  if (new Date(today).getTime() > now.getTime() + 300_000)
    results.push({ label: 'Hoje às 14:00', scheduled_at: today });
  calendar.setUTCDate(calendar.getUTCDate() + 1);
  results.push({
    label: 'Amanhã às 08:00',
    scheduled_at: at(calendar.toISOString().slice(0, 10), '08:00'),
  });
  const monday = new Date(day + 'T12:00:00Z');
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  results.push({
    label: 'Próxima segunda-feira às 08:00',
    scheduled_at: at(monday.toISOString().slice(0, 10), '08:00'),
  });
  return results;
}
export const scheduleFromLocal = (date: string, time: string, timezone: string) =>
  fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
