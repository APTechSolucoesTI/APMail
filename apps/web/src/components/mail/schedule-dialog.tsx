import { useState } from 'react';
import { schedulePresets, scheduleFromLocal, validateSchedule } from '@apmail/shared';
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
export function ScheduleDialog({
  open,
  onClose,
  onSchedule,
  timezone,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSchedule: (value: string) => void;
  timezone: string;
  busy: boolean;
}) {
  const [date, setDate] = useState(''),
    [time, setTime] = useState('08:00'),
    [error, setError] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
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
            onClick={() => onSchedule(p.scheduled_at)}
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          disabled={busy || !date || !time}
          onClick={() => {
            try {
              const v = scheduleFromLocal(date, time, timezone);
              validateSchedule(v);
              onSchedule(v);
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
