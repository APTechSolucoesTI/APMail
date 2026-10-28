import { describe, expect, it } from 'vitest';
import {
  accessScheduleSchema,
  defaultAccessSchedule,
  isWithinAccessSchedule,
} from '../src/access-schedule.js';
const tz = 'America/Sao_Paulo';
const monday = (time: string) => new Date(`2026-11-02T${time}-03:00`);
describe('Horários de acesso', () => {
  it('mantém contas existentes livres e respeita o início inclusivo e fim exclusivo', () => {
    expect(isWithinAccessSchedule(null, tz)).toBe(true);
    const s = defaultAccessSchedule();
    expect(isWithinAccessSchedule(s, tz, monday('23:00:00'))).toBe(true);
    s.enabled = true;
    for (const [time, allowed] of [
      ['07:59:59', false],
      ['08:00:00', true],
      ['16:59:59', true],
      ['17:00:00', false],
    ] as const)
      expect(isWithinAccessSchedule(s, tz, monday(time))).toBe(allowed);
  });
  it('substitui o dia inteiro por feriado ou expediente extraordinário', () => {
    const s = defaultAccessSchedule();
    s.enabled = true;
    s.exceptions = [
      { date: '2026-11-02', intervals: [], reason: 'Feriado' },
      { date: '2026-11-07', intervals: [{ start: '09:00', end: '12:00' }], reason: 'Plantão' },
    ];
    expect(isWithinAccessSchedule(s, tz, monday('10:00:00'))).toBe(false);
    expect(isWithinAccessSchedule(s, tz, new Date('2026-11-07T10:00:00-03:00'))).toBe(true);
    expect(isWithinAccessSchedule(s, tz, new Date('2026-11-14T10:00:00-03:00'))).toBe(false);
  });
  it('respeita pausas e fuso da empresa, inclusive em horário de verão', () => {
    const s = defaultAccessSchedule();
    s.enabled = true;
    s.weekly[1] = [
      { start: '08:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ];
    expect(isWithinAccessSchedule(s, tz, monday('12:30:00'))).toBe(false);
    expect(isWithinAccessSchedule(s, 'America/New_York', new Date('2026-07-06T12:00:00Z'))).toBe(
      true,
    );
    expect(isWithinAccessSchedule(s, 'America/New_York', new Date('2026-12-07T12:00:00Z'))).toBe(
      false,
    );
  });
  it('rejeita intervalos inválidos, datas repetidas, impossíveis e configuração corrompida', () => {
    const s = defaultAccessSchedule();
    s.enabled = true;
    s.weekly[1] = [{ start: '17:00', end: '08:00' }];
    expect(accessScheduleSchema.safeParse(s).success).toBe(false);
    s.weekly[1] = [
      { start: '08:00', end: '12:00' },
      { start: '11:00', end: '17:00' },
    ];
    expect(accessScheduleSchema.safeParse(s).success).toBe(false);
    s.weekly[1] = [];
    s.exceptions = [{ date: '2026-02-30', intervals: [], reason: '' }];
    expect(accessScheduleSchema.safeParse(s).success).toBe(false);
    s.exceptions = Array.from({ length: 2 }, () => ({
      date: '2026-11-02',
      intervals: [],
      reason: '',
    }));
    expect(accessScheduleSchema.safeParse(s).success).toBe(false);
    expect(isWithinAccessSchedule({}, tz)).toBe(false);
  });
  it('limita o tamanho de exceções antes de atingir a proteção do banco', () => {
    const s = defaultAccessSchedule();
    s.exceptions = Array.from({ length: 500 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      intervals: [{ start: '00:00', end: '24:00' }],
      reason: '漢'.repeat(160),
    }));
    expect(accessScheduleSchema.safeParse(s).success).toBe(false);
  });
});
