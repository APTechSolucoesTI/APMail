import type { UserProductivity } from '@apmail/shared';
export function dashboardDates(
  period: '7' | '30' | '90' | 'custom',
  timezone: string,
  from?: string,
  to?: string,
  now = new Date(),
) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const end = period === 'custom' ? (to ?? today) : today;
  const start =
    period === 'custom' && from
      ? from
      : new Date(
          new Date(end + 'T12:00:00Z').getTime() -
            (Number(period === 'custom' ? 30 : period) - 1) * 86400000,
        )
          .toISOString()
          .slice(0, 10);
  return { from: start, to: end };
}
export function durationLabel(minutes: number | null) {
  if (minutes === null) return '—';
  const total = Math.max(0, Math.round(minutes)),
    days = Math.floor(total / 1440),
    hours = Math.floor((total % 1440) / 60),
    rest = total % 60;
  return [
    days ? `${days} ${days === 1 ? 'dia' : 'dias'}` : '',
    hours ? `${hours} h` : '',
    rest || !total ? `${rest} min` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
function csvCell(value: string | number | null) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function productivityCsv(rows: UserProductivity[]) {
  const values: (string | number | null)[][] = [
    [
      'Usuário',
      'Enviados',
      'Conversas respondidas',
      'Tempo médio de resposta (min)',
      'Atribuídas em aberto',
      'Concluídas no período',
    ],
    ...rows.map((r) => [
      r.full_name,
      r.sent,
      r.threads_replied,
      r.avg_reply_minutes,
      r.open_assigned,
      r.done_in_period,
    ]),
  ];
  return '\uFEFF' + values.map((row) => row.map(csvCell).join(';')).join('\r\n');
}
