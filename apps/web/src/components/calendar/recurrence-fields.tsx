import { calendarInstant, calendarLocalInput } from '@apmail/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
const weekdays = [
  ['MO', 'Seg'],
  ['TU', 'Ter'],
  ['WE', 'Qua'],
  ['TH', 'Qui'],
  ['FR', 'Sex'],
  ['SA', 'Sáb'],
  ['SU', 'Dom'],
];
/** A friendly editor for RFC 5545 recurrence rules; no protocol syntax in the form. */
export function RecurrenceFields({
  value,
  onChange,
  timezone,
  disabled,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  timezone: string;
  disabled?: boolean;
}) {
  const parts = Object.fromEntries(
    (value ?? '')
      .split(';')
      .filter(Boolean)
      .map((part) => part.split('=')),
  );
  const set = (changes: Record<string, string | undefined>) => {
    const next = { ...parts, ...changes };
    if (!next.FREQ) {
      onChange(null);
      return;
    }
    onChange(
      Object.entries(next)
        .filter(([, v]) => v)
        .map(([k, v]) => k + '=' + v)
        .join(';'),
    );
  };
  const ending = parts.COUNT ? 'count' : parts.UNTIL ? 'date' : 'never';
  let until = '';
  if (parts.UNTIL) {
    const v = parts.UNTIL;
    try {
      until = calendarLocalInput(
        `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:00Z`,
        timezone,
      ).slice(0, 10);
    } catch {
      until = '';
    }
  }
  const field = 'h-10 w-full rounded-md border border-input bg-card px-3 text-sm';
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3">
      <label className="block space-y-1 text-sm">
        Repetir
        <select
          aria-label="Repetir"
          className={field}
          value={parts.FREQ ?? ''}
          onChange={(e) => onChange(e.target.value ? 'FREQ=' + e.target.value : null)}
        >
          <option value="">Não repetir</option>
          <option value="DAILY">Diariamente</option>
          <option value="WEEKLY">Semanalmente</option>
          <option value="MONTHLY">Mensalmente</option>
          <option value="YEARLY">Anualmente</option>
        </select>
      </label>
      {value && (
        <>
          <label className="flex items-center gap-2 text-sm">
            A cada
            <Input
              aria-label="Intervalo da repetição"
              className="w-20"
              type="number"
              min={1}
              max={366}
              value={parts.INTERVAL ?? '1'}
              onChange={(e) => set({ INTERVAL: e.target.value })}
            />
            <span>
              {
                (
                  {
                    DAILY: 'dia(s)',
                    WEEKLY: 'semana(s)',
                    MONTHLY: 'mês(es)',
                    YEARLY: 'ano(s)',
                  } as Record<string, string>
                )[parts.FREQ!]
              }
            </span>
          </label>
          {parts.FREQ === 'WEEKLY' && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Nos dias</p>
              <div className="flex flex-wrap gap-1">
                {weekdays.map(([id, label]) => (
                  <Button
                    type="button"
                    key={id}
                    size="sm"
                    aria-label={'Repetir na ' + label}
                    aria-pressed={parts.BYDAY?.split(',').includes(id!)}
                    variant={parts.BYDAY?.split(',').includes(id!) ? 'default' : 'outline'}
                    onClick={() => {
                      const days = new Set(parts.BYDAY?.split(',') ?? []);
                      if (days.has(id!)) days.delete(id!);
                      else days.add(id!);
                      set({ BYDAY: [...days].join(',') });
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {parts.FREQ === 'MONTHLY' && (
            <>
              <label className="block space-y-1 text-sm">
                Padrão mensal
                <select
                  aria-label="Padrão mensal"
                  className={field}
                  value={parts.BYDAY ? 'weekday' : 'date'}
                  onChange={(e) =>
                    set({
                      BYDAY: e.target.value === 'weekday' ? '1MO' : undefined,
                      BYMONTHDAY: undefined,
                    })
                  }
                >
                  <option value="date">Mesmo dia do mês</option>
                  <option value="weekday">Dia da semana</option>
                </select>
              </label>
              {parts.BYDAY && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Semana do mês"
                    className={field}
                    value={parts.BYDAY.slice(0, -2)}
                    onChange={(e) => set({ BYDAY: e.target.value + parts.BYDAY!.slice(-2) })}
                  >
                    {[
                      ['1', 'Primeira'],
                      ['2', 'Segunda'],
                      ['3', 'Terceira'],
                      ['4', 'Quarta'],
                      ['-1', 'Última'],
                    ].map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Dia da semana"
                    className={field}
                    value={parts.BYDAY.slice(-2)}
                    onChange={(e) => set({ BYDAY: parts.BYDAY!.slice(0, -2) + e.target.value })}
                  >
                    {weekdays.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Terminar
              <select
                aria-label="Fim da repetição"
                className={field}
                value={ending}
                onChange={(e) =>
                  set({
                    COUNT: e.target.value === 'count' ? '10' : undefined,
                    UNTIL:
                      e.target.value === 'date'
                        ? new Date(Date.now() + 30 * 86400000)
                            .toISOString()
                            .replace(/[-:]/g, '')
                            .slice(0, 15) + 'Z'
                        : undefined,
                  })
                }
              >
                <option value="never">Nunca</option>
                <option value="count">Após um número de vezes</option>
                <option value="date">Em uma data</option>
              </select>
            </label>
            {ending === 'count' && (
              <label className="space-y-1 text-sm">
                Ocorrências
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={parts.COUNT ?? 10}
                  onChange={(e) => set({ COUNT: e.target.value })}
                />
              </label>
            )}
            {ending === 'date' && (
              <label className="space-y-1 text-sm">
                Até
                <Input
                  type="date"
                  required
                  value={until}
                  onChange={(e) => {
                    if (e.target.value)
                      set({
                        UNTIL:
                          calendarInstant(e.target.value + 'T23:59', timezone)
                            .replace(/[-:]/g, '')
                            .slice(0, 15) + 'Z',
                      });
                  }}
                />
              </label>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
