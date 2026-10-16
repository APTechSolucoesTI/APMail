import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, Check, Clock, X, Repeat2, Pencil } from 'lucide-react';
import {
  calendarInstant,
  calendarLocalInput,
  recurrenceLabel,
  type Recurrence,
  type ListResult,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorState, LoadingState } from '@/components/data/data-state';
import { toast } from 'sonner';
import { Pagination } from '@/components/data/pagination';
import { DateTimeField } from '@/components/calendar/date-time-field';
type Reminder = {
  id: string;
  event_id: string | null;
  title: string;
  notes: string;
  due_at: string;
  status: string;
  recurrence: Recurrence | null;
};
export const Route = createFileRoute('/_app/reminders')({ component: RemindersPage });
function RemindersPage() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery),
    timezone = me.data?.preferences.timezone ?? 'America/Sao_Paulo';
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState('active'),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(''),
    [notes, setNotes] = useState(''),
    [due, setDue] = useState(() =>
      calendarLocalInput(new Date(Date.now() + 3600000).toISOString(), timezone),
    ),
    [unit, setUnit] = useState(''),
    [interval, setInterval] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string | null>(null);
  const reminders = useQuery({
    queryKey: ['calendar', tenant, 'reminders', filter, page, pageSize],
    queryFn: () =>
      api<ListResult<Reminder>>(
        '/reminders?status=' + filter + '&page=' + page + '&pageSize=' + pageSize,
      ),
    refetchInterval: 30000,
  });
  const action = async (id: string, action: string, minutes?: number) => {
    setBusy(id);
    try {
      await api('/reminders/' + id + '/action', { method: 'POST', body: { action, minutes } });
      await client.invalidateQueries({ queryKey: ['calendar'] });
      await client.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(
        action === 'snooze'
          ? 'Lembrete adiado.'
          : action === 'complete'
            ? 'Concluído.'
            : 'Lembrete dispensado.',
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Lembretes e tarefas</h1>
          <p className="text-xs text-muted-foreground">
            Seus lembretes e compromissos próximos · {timezone}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setTitle('');
            setNotes('');
            setUnit('');
            setInterval(1);
            setDue(calendarLocalInput(new Date(Date.now() + 3600000).toISOString(), timezone));
            setError('');
            setOpen(true);
          }}
        >
          <Plus />
          Novo lembrete
        </Button>
      </header>
      <div className="flex items-center gap-2">
        <label htmlFor="reminder-filter" className="text-sm">
          Exibir
        </label>
        <select
          id="reminder-filter"
          className="h-9 rounded-md border bg-card px-3 text-sm"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="active">Pendentes</option>
          <option value="completed">Concluídos e dispensados</option>
          <option value="all">Todos</option>
        </select>
        <span role="status" className="text-xs text-muted-foreground">
          {reminders.data?.total ?? 0} lembrete(s)
        </span>
      </div>
      {reminders.data && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <Pagination
              page={reminders.data.page}
              pageSize={pageSize}
              total={reminders.data.total}
              onPageChange={setPage}
            />
          </div>
          <label className="text-xs">
            Por página{' '}
            <select
              aria-label="Lembretes por página"
              className="h-9 rounded-md border bg-card px-2"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 30, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {reminders.isPending ? (
        <LoadingState />
      ) : reminders.error ? (
        <ErrorState onRetry={() => void reminders.refetch()} />
      ) : !reminders.data.items.length ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border bg-card p-8 text-center">
          <Bell className="mb-3 size-8 text-muted-foreground" />
          <h2 className="font-semibold">Nenhum lembrete neste filtro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie um lembrete ou configure a antecedência em um compromisso.
          </p>
        </div>
      ) : (
        <ul className="overflow-auto rounded-lg border bg-card divide-y">
          {reminders.data.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 p-4">
              <Bell
                className={
                  'mt-1 size-4 shrink-0 ' +
                  (r.status === 'notified' ? 'text-primary' : 'text-muted-foreground')
                }
              />
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-sm font-semibold">{r.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(r.due_at).toLocaleString('pt-BR', { timeZone: timezone })} ·{' '}
                  {
                    (
                      {
                        pending: 'Agendado',
                        notified: 'Notificado',
                        completed: 'Concluído',
                        dismissed: 'Dispensado',
                      } as Record<string, string>
                    )[r.status]
                  }
                  {r.event_id ? ' · Compromisso' : ''}
                </p>
                {r.notes && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {r.notes}
                  </p>
                )}
                {r.recurrence && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Repeat2 className="size-3" />
                    {recurrenceLabel(r.recurrence)}
                  </p>
                )}
              </div>
              {['pending', 'notified'].includes(r.status) && (
                <div className="flex flex-wrap gap-1">
                  {!r.event_id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy === r.id}
                      aria-label={'Editar ' + r.title}
                      onClick={() => {
                        setEditing(r.id);
                        setTitle(r.title);
                        setNotes(r.notes);
                        setDue(calendarLocalInput(r.due_at, timezone));
                        setUnit(r.recurrence?.unit ?? '');
                        setInterval(r.recurrence?.interval ?? 1);
                        setOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === r.id}
                    onClick={() => void action(r.id, 'complete')}
                  >
                    <Check />
                    Concluir
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" disabled={busy === r.id}>
                        <Clock />
                        Adiar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {[5, 15, 30, 60, 1440].map((minutes) => (
                        <DropdownMenuItem
                          key={minutes}
                          onSelect={() => void action(r.id, 'snooze', minutes)}
                        >
                          {minutes === 1440
                            ? '1 dia'
                            : minutes === 60
                              ? '1 hora'
                              : minutes + ' minutos'}
                        </DropdownMenuItem>
                      ))}
                      {r.recurrence && (
                        <DropdownMenuItem onSelect={() => void action(r.id, 'stop')}>
                          Encerrar repetição
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={'Dispensar ' + r.title}
                    disabled={busy === r.id}
                    onClick={() => void action(r.id, 'dismiss')}
                  >
                    <X />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {reminders.data && reminders.data.total > pageSize && (
        <Pagination
          page={reminders.data.page}
          pageSize={pageSize}
          total={reminders.data.total}
          onPageChange={setPage}
        />
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar lembrete' : 'Novo lembrete'}</DialogTitle>
            <DialogDescription>Escolha quando deseja ser lembrado.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy('new');
              setError('');
              void (async () => {
                try {
                  await api('/reminders' + (editing ? '/' + editing : ''), {
                    method: editing ? 'PATCH' : 'POST',
                    body: {
                      title,
                      notes,
                      due_at: calendarInstant(due, timezone),
                      recurrence: unit ? { unit, interval, timezone } : null,
                    },
                  });
                  await client.invalidateQueries({ queryKey: ['calendar'] });
                  setOpen(false);
                  setTitle('');
                  setNotes('');
                  toast.success(editing ? 'Lembrete atualizado.' : 'Lembrete criado.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            <label className="block space-y-1 text-sm">
              Título
              <Input
                autoFocus
                required
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <DateTimeField label="Quando" value={due} onChange={setDue} />
            <label className="block space-y-1 text-sm">
              Notas
              <Textarea
                maxLength={10000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Repetir
              <select
                className="h-10 w-full rounded-md border bg-card px-3"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="">Não repetir</option>
                <option value="day">Dias</option>
                <option value="week">Semanas</option>
                <option value="month">Meses</option>
                <option value="hour">Horas</option>
              </select>
            </label>
            {unit && (
              <label className="block space-y-1 text-sm">
                Intervalo
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!!busy}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button disabled={!!busy}>
                {busy ? 'Salvando…' : editing ? 'Salvar' : 'Criar lembrete'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
