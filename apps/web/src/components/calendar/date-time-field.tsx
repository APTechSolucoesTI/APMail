import { useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Clock, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
export function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]),
    minute = Number(match[2] ?? 0);
  return hour < 24 && minute < 60
    ? String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
    : null;
}
const times = Array.from(
  { length: 96 },
  (_, i) =>
    String(Math.floor(i / 4)).padStart(2, '0') + ':' + String((i % 4) * 15).padStart(2, '0'),
);
function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const custom = normalizeTime(query),
    select = (time: string) => {
      onChange(time);
      setOpen(false);
      setQuery('');
    };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full justify-between font-normal tabular-nums"
        >
          <span>{value || 'Escolher hora'}</span>
          <Clock className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="end">
        <Command label={'Pesquisar ' + label.toLowerCase()} defaultValue={value}>
          <CommandInput
            aria-label={'Pesquisar ' + label.toLowerCase()}
            placeholder="Digite ou escolha a hora"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-60">
            <CommandEmpty>Digite um horário como 09:30.</CommandEmpty>
            {!query && !times.includes(value) && (
              <CommandItem value={value} onSelect={() => select(value)}>
                {value}
                <Check className="ml-auto size-4 text-primary" />
              </CommandItem>
            )}
            {custom && !times.includes(custom) && (
              <CommandItem value={query} onSelect={() => select(custom)}>
                Usar {custom}
              </CommandItem>
            )}
            {times.map((time) => (
              <CommandItem key={time} value={time} onSelect={() => select(time)}>
                <span className="tabular-nums">{time}</span>
                {value === time && <Check className="ml-auto size-4 text-primary" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
export function DateTimeField({
  label,
  value,
  onChange,
  allDay = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allDay?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    date = value.slice(0, 10),
    time = value.slice(11, 16) || '09:00';
  const parsed = parseISO(date + 'T12:00:00'),
    selected = isValid(parsed) ? parsed : undefined;
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_7.5rem]">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={'Data de ' + label.toLowerCase()}
            className="h-10 min-w-0 justify-start gap-2 font-normal"
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selected
                ? format(selected, "EEE, dd 'de' MMM 'de' yyyy", { locale: ptBR })
                : 'Selecionar data'}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(day) => {
              if (day) {
                onChange(format(day, 'yyyy-MM-dd') + 'T' + time);
                setOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
      {!allDay && (
        <div className="col-start-2 sm:col-start-auto">
          <TimeField
            label={'Horário de ' + label.toLowerCase()}
            value={time}
            disabled={disabled}
            onChange={(next) => onChange(date + 'T' + next)}
          />
        </div>
      )}
    </div>
  );
}
