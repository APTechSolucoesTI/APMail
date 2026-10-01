import { expect, it } from 'vitest';
import { dashboardDates, durationLabel, productivityCsv } from './dashboard';
it('intervalos usam o dia do tenant, incluem os limites e cruzam meses', () => {
  expect(
    dashboardDates(
      '7',
      'America/Sao_Paulo',
      undefined,
      undefined,
      new Date('2026-10-01T02:00:00Z'),
    ),
  ).toEqual({ from: '2026-09-24', to: '2026-09-30' });
  expect(dashboardDates('custom', 'UTC', '2026-01-02', '2026-01-05')).toEqual({
    from: '2026-01-02',
    to: '2026-01-05',
  });
  expect(durationLabel(1640)).toBe('1 dia 3 h 20 min');
  expect(durationLabel(null)).toBe('—');
});
it('CSV preserva UTF-8 e aspas e neutraliza fórmulas em nomes', () => {
  const csv = productivityCsv(
    ['=HYPERLINK("x")', ' +SUM(1)', '@formula', 'José; "Silva"'].map((full_name) => ({
      user_id: full_name,
      full_name,
      avatar_url: null,
      sent: 3,
      threads_replied: 2,
      avg_reply_minutes: null,
      open_assigned: 1,
      done_in_period: 0,
    })),
  );
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  expect(csv).toContain('"\' +SUM(1)"');
  expect(csv).toContain('"\'@formula"');
  expect(csv).toContain('"José; ""Silva"""');
});
