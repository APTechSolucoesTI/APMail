import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Plus, Pencil, ListTodo, X } from 'lucide-react';
import {
  calendarInstant,
  calendarLocalInput,
  isTenantAdmin,
  type Recurrence,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
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
import { DateTimeField } from '@/components/calendar/date-time-field';
import { toast } from 'sonner';

type EmailTask = {
  id: string;
  title: string;
  notes: string;
  due_at: string;
  status: string;
  user_id: string;
  assignee_name: string;
  recurrence?: Recurrence | null;
};
const schema = z.object({
  title: z.string().trim().min(1, 'Informe o título.').max(300),
  notes: z.string().max(10000),
  due: z.string().min(1, 'Informe o prazo.'),
  user_id: z.string().min(1),
});
type Values = z.infer<typeof schema>;
export function ThreadTasks({
  threadId,
  subject,
}: {
  threadId: string;
  mailboxId: string;
  subject: string;
}) {
  const tenant = useTenantId(),
    me = useQuery(meQuery),
    client = useQueryClient();
  const admin = isTenantAdmin(me.data?.tenants.find((t) => t.id === tenant)?.role ?? null);
  const timezone = me.data?.preferences.timezone ?? 'America/Sao_Paulo';
  const tasks = useQuery({
    queryKey: ['calendar', tenant, 'thread-tasks', threadId],
    queryFn: () => api<EmailTask[]>('/threads/' + threadId + '/tasks'),
  });
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<EmailTask | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const assignees = useQuery({
    queryKey: ['task-assignees', tenant, threadId],
    queryFn: () =>
      api<{ id: string; full_name: string }[]>('/threads/' + threadId + '/task-assignees'),
    enabled: open && admin,
  });
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const refresh = async () => {
    for (const key of ['calendar', 'thread', 'threads', 'notifications', 'queue-counts'])
      await client.invalidateQueries({ queryKey: [key] });
  };
  const edit = (task: EmailTask | null) => {
    setEditing(task);
    setError('');
    form.reset({
      title: task?.title ?? subject.slice(0, 300),
      notes: task?.notes ?? '',
      due: calendarLocalInput(
        task?.due_at ?? new Date(Date.now() + 3600000).toISOString(),
        timezone,
      ),
      user_id: task?.user_id ?? me.data?.user.id ?? '',
    });
    setOpen(true);
  };
  const action = async (task: EmailTask, action: 'complete' | 'dismiss') => {
    setBusy(task.id);
    try {
      await api('/reminders/' + task.id + '/action', { method: 'POST', body: { action } });
      await refresh();
      toast.success(action === 'complete' ? 'Tarefa concluída.' : 'Tarefa dispensada.');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy('');
    }
  };
  const pending =
    tasks.data?.filter((task) => ['pending', 'notified'].includes(task.status)).length ?? 0;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Tarefas do e-mail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="size-4" />
          Tarefas do e-mail{' '}
          {tasks.data && (
            <span className="font-normal text-muted-foreground">
              ({pending} {pending === 1 ? 'pendente' : 'pendentes'})
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={() => edit(null)}>
          <Plus />
          Nova tarefa
        </Button>
      </div>
      {tasks.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando tarefas…
        </p>
      ) : tasks.isError ? (
        <div role="alert" className="text-sm">
          Não foi possível carregar as tarefas.{' '}
          <Button variant="link" size="sm" onClick={() => void tasks.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !tasks.data.length ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma tarefa vinculada. Defina a próxima ação deste e-mail.
        </p>
      ) : (
        <ul className="divide-y">
          {tasks.data.map((task) => {
            const active = ['pending', 'notified'].includes(task.status),
              editable = admin || task.user_id === me.data?.user.id;
            return (
              <li key={task.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{task.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.assignee_name} ·{' '}
                      {new Date(task.due_at).toLocaleString('pt-BR', { timeZone: timezone })}
                    </p>
                  </div>
                  <span
                    className={
                      'rounded border px-2 py-1 text-xs ' +
                      (active ? 'bg-warning-bg text-warning-fg' : 'bg-muted text-muted-foreground')
                    }
                  >
                    {active ? 'Pendente' : task.status === 'completed' ? 'Concluída' : 'Dispensada'}
                  </span>
                </div>
                {task.notes && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {task.notes}
                  </p>
                )}
                {active && editable && (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void action(task, 'complete')}
                    >
                      <Check />
                      Concluir
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => edit(task)}>
                      <Pencil />
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void action(task, 'dismiss')}
                    >
                      <X />
                      Dispensar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar tarefa' : 'Nova tarefa do e-mail'}</DialogTitle>
            <DialogDescription>
              Defina a ação, o prazo e o responsável. Horários em {timezone}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              setBusy('save');
              setError('');
              try {
                const due_at = calendarInstant(values.due, timezone);
                await api('/reminders' + (editing ? '/' + editing.id : ''), {
                  method: editing ? 'PATCH' : 'POST',
                  body: {
                    title: values.title,
                    notes: values.notes,
                    due_at,
                    user_id: values.user_id,
                    thread_id: threadId,
                    recurrence: editing?.recurrence ?? null,
                  },
                });
                await refresh();
                setOpen(false);
                toast.success(editing ? 'Tarefa atualizada.' : 'Tarefa criada.');
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy('');
              }
            })}
          >
            <label className="block space-y-1 text-sm">
              Título
              <Input
                autoFocus
                maxLength={300}
                aria-invalid={!!form.formState.errors.title}
                {...form.register('title')}
              />
              {form.formState.errors.title && (
                <span role="alert" className="text-destructive">
                  {form.formState.errors.title.message}
                </span>
              )}
            </label>
            <Controller
              name="due"
              control={form.control}
              render={({ field }) => (
                <DateTimeField label="Prazo" value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            <label className="block space-y-1 text-sm">
              Notas
              <Textarea maxLength={10000} {...form.register('notes')} />
            </label>
            {admin && (
              <label htmlFor="email-task-owner" className="block space-y-1 text-sm">
                Responsável
                <select
                  id="email-task-owner"
                  className="h-10 w-full rounded-md border bg-background px-3"
                  {...form.register('user_id')}
                >
                  <option value={me.data?.user.id}>{me.data?.user.full_name} (você)</option>
                  {editing &&
                    editing.user_id !== me.data?.user.id &&
                    !assignees.data?.some((user) => user.id === editing.user_id) && (
                      <option value={editing.user_id}>
                        {editing.assignee_name} (responsável atual)
                      </option>
                    )}
                  {assignees.data
                    ?.filter((user) => user.id !== me.data?.user.id)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}
                      </option>
                    ))}
                </select>
                {assignees.isError && (
                  <span role="alert" className="text-destructive">
                    Não foi possível carregar os responsáveis.
                  </span>
                )}
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
              <Button disabled={!!busy}>{busy ? 'Salvando…' : 'Salvar tarefa'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
