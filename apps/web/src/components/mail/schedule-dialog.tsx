import { useState } from 'react';
import {
  schedulePresets,
  scheduleFromLocal,
  validateSchedule,
  recurrenceSchema,
  type SendSchedule,
  type Recurrence,
} from '@apmail/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
export function ScheduleDialog({
  open,
  onClose,
  onSchedule,
  timezone,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSchedule: (value: SendSchedule) => void;
  timezone: string;
  busy: boolean;
}) {
  const [date, setDate] = useState(''),
    [time, setTime] = useState('08:00'),
    [error, setError] = useState('');
  const [repeat, setRepeat] = useState(false),
    [interval, setInterval] = useState('1'),
    [unit, setUnit] = useState<Recurrence['unit']>('week'),
    [ending, setEnding] = useState('never'),
    [endDate, setEndDate] = useState(''),
    [count, setCount] = useState('10');
  const schedule = (value: string) => {
    try {
      validateSchedule(value);
      if (
        repeat &&
        (!Number.isInteger(Number(interval)) || Number(interval) < 1 || Number(interval) > 365)
      )
        throw new Error('Informe um intervalo inteiro entre 1 e 365.');
      if (
        repeat &&
        ending === 'count' &&
        (!Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 10000)
      )
        throw new Error('Informe uma quantidade inteira entre 1 e 10.000 envios.');
      const recurrence = repeat
        ? recurrenceSchema.parse({
            interval: Number(interval),
            unit,
            timezone,
            max_occurrences: ending === 'count' ? Number(count) : undefined,
            end_at:
              ending === 'date' && endDate
                ? scheduleFromLocal(endDate, '23:59', timezone)
                : undefined,
          })
        : undefined;
      if (repeat && ending === 'date' && !endDate) throw new Error('Escolha a data de término.');
      if (recurrence?.end_at && new Date(recurrence.end_at) < new Date(value))
        throw new Error('O término deve ser após o primeiro envio.');
      setError('');
      onSchedule({ scheduled_at: value, ...(recurrence ? { recurrence } : {}) });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Verifique a data e a recorrência.');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agendar envio</DialogTitle>
          <DialogDescription>
            Horários no fuso {timezone}. O envio deve estar entre 5 minutos e 365 dias a partir de
            agora.
          </DialogDescription>
        </DialogHeader>
        {schedulePresets(timezone).map((p) => (
          <Button
            key={p.label}
            disabled={busy}
            variant="outline"
            onClick={() => schedule(p.scheduled_at)}
          >
            {p.label}
          </Button>
        ))}
        <Label htmlFor="schedule-date">Data</Label>
        <Input
          id="schedule-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Label htmlFor="schedule-time">Hora</Label>
        <Input
          id="schedule-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <div className="space-y-3 rounded-md border p-3">
          <Label className="flex min-h-11 items-center gap-2" htmlFor="schedule-repeat">
            <Checkbox
              id="schedule-repeat"
              checked={repeat}
              onCheckedChange={(value) => setRepeat(value === true)}
            />
            Repetir este envio
          </Label>
          {repeat && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="schedule-interval">A cada</Label>
                  <Input
                    id="schedule-interval"
                    type="number"
                    min={1}
                    max={365}
                    value={interval}
                    onChange={(event) => setInterval(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="schedule-unit">Período</Label>
                  <select
                    id="schedule-unit"
                    className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value as Recurrence['unit'])}
                  >
                    <option value="hour">Hora(s)</option>
                    <option value="day">Dia(s)</option>
                    <option value="week">Semana(s)</option>
                    <option value="month">Mês(es)</option>
                  </select>
                </div>
              </div>
              <Label htmlFor="schedule-ending">Terminar</Label>
              <select
                id="schedule-ending"
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={ending}
                onChange={(event) => setEnding(event.target.value)}
              >
                <option value="never">Quando eu cancelar</option>
                <option value="count">Após uma quantidade de envios</option>
                <option value="date">Em uma data</option>
              </select>
              {ending === 'count' && (
                <div className="space-y-1">
                  <Label htmlFor="schedule-count">Total de envios, incluindo o primeiro</Label>
                  <Input
                    id="schedule-count"
                    type="number"
                    min={1}
                    max={10000}
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                  />
                </div>
              )}
              {ending === 'date' && (
                <div className="space-y-1">
                  <Label htmlFor="schedule-end-date">Data de término</Label>
                  <Input
                    id="schedule-end-date"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                O mesmo conteúdo e destinatários serão usados nos próximos envios. Você pode parar a
                recorrência em Envios → Agendados. Horários perdidos enquanto o servidor estiver
                parado não são enviados em lote.
              </p>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          disabled={busy || !date || !time}
          onClick={() => {
            try {
              schedule(scheduleFromLocal(date, time, timezone));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Agendar no horário escolhido
        </Button>
      </DialogContent>
    </Dialog>
  );
}
