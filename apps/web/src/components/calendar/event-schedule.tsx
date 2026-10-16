import { calendarInstant, calendarLocalInput } from '@apmail/shared';
import { DateTimeField } from './date-time-field';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
const durationOptions = [15, 30, 45, 60, 90, 120, 180, 240];
export function EventSchedule({
  start,
  end,
  onChange,
  timezone,
  allDay,
  onAllDayChange,
  disabled,
  allowAllDay = true,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  timezone: string;
  allDay: boolean;
  onAllDayChange: (value: boolean) => void;
  disabled?: boolean;
  allowAllDay?: boolean;
}) {
  const duration = (() => {
    try {
      return Math.round(
        (+new Date(calendarInstant(end, timezone)) - +new Date(calendarInstant(start, timezone))) /
          60000,
      );
    } catch {
      return 60;
    }
  })();
  const changeStart = (next: string) => {
    if (allDay) {
      onChange(
        next.slice(0, 10) + 'T00:00',
        format(
          addDays(
            parseISO(next),
            Math.max(1, differenceInCalendarDays(parseISO(end), parseISO(start))),
          ),
          'yyyy-MM-dd',
        ) + 'T00:00',
      );
      return;
    }
    try {
      const nextEnd = calendarLocalInput(
        new Date(
          +new Date(calendarInstant(next, timezone)) + Math.max(15, duration) * 60000,
        ).toISOString(),
        timezone,
      );
      onChange(next, nextEnd);
    } catch {
      onChange(next, end);
    }
  };
  return (
    <section aria-label="Data e horário" className="space-y-3">
      <DateTimeField
        label="Início"
        value={start}
        disabled={disabled}
        allDay={allDay}
        onChange={changeStart}
      />
      <DateTimeField
        label="Término"
        value={allDay ? format(addDays(parseISO(end), -1), 'yyyy-MM-dd') + 'T00:00' : end}
        disabled={disabled}
        allDay={allDay}
        onChange={(value) =>
          onChange(
            start,
            allDay ? format(addDays(parseISO(value), 1), 'yyyy-MM-dd') + 'T00:00' : value,
          )
        }
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pl-0 sm:pl-[4.75rem]">
        {allowAllDay && (
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={allDay}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) {
                  const nextStart = start.slice(0, 10) + 'T00:00',
                    nextEnd =
                      end.slice(0, 10) > start.slice(0, 10)
                        ? end.slice(0, 10) + 'T00:00'
                        : format(addDays(parseISO(start), 1), 'yyyy-MM-dd') + 'T00:00';
                  onChange(nextStart, nextEnd);
                } else {
                  onChange(start.slice(0, 10) + 'T09:00', start.slice(0, 10) + 'T10:00');
                }
                onAllDayChange(checked);
              }}
            />
            Dia inteiro
          </label>
        )}
        {!allDay && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Duração
            <select
              aria-label="Duração"
              disabled={disabled}
              className="h-9 rounded-md border bg-card px-2 text-foreground"
              value={durationOptions.includes(duration) ? duration : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom')
                  onChange(
                    start,
                    calendarLocalInput(
                      new Date(
                        +new Date(calendarInstant(start, timezone)) +
                          Number(e.target.value) * 60000,
                      ).toISOString(),
                      timezone,
                    ),
                  );
              }}
            >
              {durationOptions.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 60
                    ? minutes + ' minutos'
                    : minutes / 60 + ' hora' + (minutes === 60 ? '' : 's')}
                </option>
              ))}
              {!durationOptions.includes(duration) && (
                <option value="custom">{duration} minutos</option>
              )}
            </select>
          </label>
        )}
        <span className="text-xs text-muted-foreground">{timezone.replaceAll('_', ' ')}</span>
      </div>
    </section>
  );
}
