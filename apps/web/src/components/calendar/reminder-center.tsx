import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Clock, Video, CalendarDays, ChevronDown } from 'lucide-react';
import type { CalendarAttendee } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
type Alert = {
  id: string;
  title: string;
  notes: string;
  description: string | null;
  due_at: string;
  event_id: string | null;
  event_start_at: string | null;
  event_end_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  meeting_url: string | null;
  attendees: CalendarAttendee[] | null;
  timezone: string | null;
};
export function ReminderCenter() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    [clientId] = useState(() => crypto.randomUUID()),
    [visible, setVisible] = useState(() => document.visibilityState === 'visible'),
    [blocked, setBlocked] = useState(false),
    [minimizedFor, setMinimizedFor] = useState(''),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [snooze, setSnooze] = useState('5'),
    [custom, setCustom] = useState(10),
    [now, setNow] = useState(Date.now);
  const alerts = useQuery({
    queryKey: ['calendar', tenant, 'alerts', clientId],
    enabled: !!tenant && visible,
    queryFn: () =>
      api<Alert[]>('/reminders/alerts/claim', { method: 'POST', body: { client_id: clientId } }),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState === 'visible'),
      release = () => {
        navigator.sendBeacon(
          '/api/reminders/alerts/release',
          new Blob([JSON.stringify({ client_id: clientId })], { type: 'application/json' }),
        );
      };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', release);
    const observer = new MutationObserver(() =>
      setBlocked(!!document.querySelector('[role="dialog"]:not([data-reminder-popup])')),
    );
    observer.observe(document.body, { subtree: true, childList: true });
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', release);
      observer.disconnect();
      clearInterval(timer);
    };
  }, [clientId, tenant]);
  const items = alerts.data ?? [],
    signature = items.map((a) => a.id).join(','),
    active = items.find((a) => a.id === selected) ?? items[0],
    minimized = signature === minimizedFor;
  const act = async (action: 'snooze' | 'dismiss', all = false) => {
    setBusy(true);
    setError('');
    try {
      await Promise.all(
        (all ? items : active ? [active] : []).map((item) =>
          api('/reminders/' + item.id + '/action', {
            method: 'POST',
            body: { action, minutes: snooze === 'custom' ? custom : Number(snooze) },
          }),
        ),
      );
      await client.invalidateQueries({ queryKey: ['calendar'] });
      await client.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!active || !visible || now > alerts.dataUpdatedAt + 40000) return null;
  const start = active.event_start_at ?? active.starts_at ?? active.due_at,
    minutes = Math.round((+new Date(start) - now) / 60000),
    when =
      minutes > 0
        ? 'Começa em ' + minutes + ' minuto' + (minutes === 1 ? '' : 's')
        : minutes === 0
          ? 'Está na hora'
          : 'Há ' + Math.abs(minutes) + ' minuto' + (minutes === -1 ? '' : 's') + ' de atraso';
  return (
    <>
      <Button
        className="fixed right-4 bottom-4 z-40 shadow-lg"
        onClick={() => setMinimizedFor('')}
        aria-label={'Abrir ' + items.length + ' lembretes'}
      >
        <BellRing className="size-4" />
        {items.length} lembrete{items.length === 1 ? '' : 's'}
      </Button>
      <Dialog
        modal={false}
        open={!blocked && !minimized}
        onOpenChange={(open) => {
          if (!open && !busy) setMinimizedFor(signature);
        }}
      >
        <DialogContent
          data-reminder-popup
          className="fixed top-auto right-4 bottom-4 left-auto max-h-[85dvh] translate-x-0 translate-y-0 overflow-auto p-0 sm:max-w-lg"
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b p-4 text-left">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base">
                <BellRing className="size-5 text-primary" />
                Lembretes{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {items.length} pendente{items.length === 1 ? '' : 's'}
                </span>
              </DialogTitle>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setMinimizedFor(signature)}
                aria-label="Minimizar lembretes"
              >
                <ChevronDown />
              </Button>
            </div>
            <DialogDescription>
              Adie ou dispense os lembretes que já foram vistos.
            </DialogDescription>
          </DialogHeader>
          {items.length > 1 && (
            <ul className="max-h-36 overflow-auto border-b p-2" aria-label="Lembretes pendentes">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={active.id === item.id}
                    disabled={busy}
                    onClick={() => setSelected(item.id)}
                    className={
                      'block w-full rounded-md px-3 py-2 text-left text-sm ' +
                      (active.id === item.id
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted')
                    }
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-3 p-4">
            <h3 className="text-lg font-semibold">{active.title}</h3>
            <p className="flex items-center gap-2 text-sm text-primary">
              <Clock className="size-4" />
              {when}
            </p>
            <p className="text-sm text-muted-foreground">
              {new Date(start).toLocaleString('pt-BR', {
                timeZone: active.timezone ?? undefined,
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
            {(active.description || active.notes) && (
              <p className="max-h-28 overflow-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {active.description || active.notes}
              </p>
            )}
            {!!active.attendees?.length && (
              <p className="text-xs text-muted-foreground">
                Participantes: {active.attendees.map((a) => a.name || a.address).join(', ')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {active.event_id && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to="/calendar"
                    search={{ event: active.event_id }}
                    onClick={() => setMinimizedFor(signature)}
                  >
                    <CalendarDays />
                    Abrir evento
                  </Link>
                </Button>
              )}
              {active.meeting_url && (
                <Button asChild size="sm">
                  <a href={active.meeting_url} target="_blank" rel="noopener noreferrer">
                    <Video />
                    Entrar na reunião
                  </a>
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-3 border-t bg-card p-4">
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Adiar por
              <select
                aria-label="Adiar lembrete por"
                className="h-10 rounded-md border bg-background px-2"
                value={snooze}
                disabled={busy}
                onChange={(e) => setSnooze(e.target.value)}
              >
                {[5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? m + ' minutos' : '1 hora'}
                  </option>
                ))}
                <option value="custom">Personalizar</option>
              </select>
              {snooze === 'custom' && (
                <Input
                  aria-label="Minutos para adiar"
                  type="number"
                  className="w-24"
                  min={1}
                  max={10080}
                  value={custom}
                  onChange={(e) => setCustom(Number(e.target.value))}
                />
              )}
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              {items.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act('dismiss', true)}
                >
                  Dispensar todos
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void act('dismiss')}>
                Dispensar
              </Button>
              <Button
                disabled={
                  busy ||
                  (snooze === 'custom' &&
                    (!Number.isInteger(custom) || custom < 1 || custom > 10080))
                }
                onClick={() => void act('snooze')}
              >
                {busy ? 'Aguarde…' : 'Adiar'}
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
