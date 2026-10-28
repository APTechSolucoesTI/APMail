import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  accessScheduleSchema,
  WEEK_DAYS,
  type AccessSchedule,
  type AccessInterval,
} from '@apmail/shared';
import { Plus, Trash2, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type ScheduleResponse = { schedule: AccessSchedule; timezone: string };
const regular = () => [{ start: '08:00', end: '17:00' }];
function Intervals({
  value,
  onChange,
  label,
  errorAt,
}: {
  value: AccessInterval[];
  onChange: (value: AccessInterval[]) => void;
  label: string;
  errorAt: (i: number, key: 'start' | 'end') => string | undefined;
}) {
  const fieldPrefix = useId();
  return (
    <div className="space-y-2">
      {value.map((interval, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2">
          {(['start', 'end'] as const).map((key) => (
            <label key={key} className="min-w-0 flex-1 text-xs text-muted-foreground">
              {key === 'start' ? 'Início' : 'Fim'}
              <Input
                className="mt-1 h-9 min-w-0"
                aria-label={`${label}, intervalo ${i + 1}, ${key === 'start' ? 'início' : 'fim'}`}
                inputMode="text"
                placeholder={key === 'start' ? '08:00' : '17:00'}
                value={interval[key]}
                aria-invalid={!!errorAt(i, key)}
                aria-describedby={errorAt(i, key) ? `${fieldPrefix}-${i}-${key}-error` : undefined}
                onChange={(e) =>
                  onChange(value.map((v, j) => (j === i ? { ...v, [key]: e.target.value } : v)))
                }
              />
              {errorAt(i, key) && (
                <span
                  id={`${fieldPrefix}-${i}-${key}-error`}
                  role="alert"
                  className="mt-1 block text-destructive"
                >
                  {errorAt(i, key)}
                </span>
              )}
            </label>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-5 shrink-0"
            aria-label={`Remover intervalo ${i + 1} de ${label}`}
            onClick={() => onChange(value.filter((_, j) => i !== j))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      {value.length > 0 && value.length < 4 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...value, { start: '18:00', end: '20:00' }])}
        >
          <Plus className="size-4" />
          Adicionar intervalo
        </Button>
      )}
    </div>
  );
}
function ScheduleForm({
  userId,
  initial,
  onDone,
}: {
  userId: string;
  initial: ScheduleResponse;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<AccessSchedule>({
    resolver: zodResolver(accessScheduleSchema),
    defaultValues: initial.schedule,
  });
  const [enabled, weekly, exceptions] = useWatch({
    control: form.control,
    name: ['enabled', 'weekly', 'exceptions'] as const,
  });
  const value = { enabled, weekly, exceptions };
  const errors = form.formState.errors;
  const save = async (schedule: AccessSchedule) => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await api('/members/' + userId + '/access-schedule', { method: 'PUT', body: schedule });
      await client.invalidateQueries({ queryKey: ['members'] });
      await client.invalidateQueries({ queryKey: ['member-access-schedule'] });
      toast.success('Horário de acesso salvo.');
      onDone();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        if (!value.enabled) {
          e.preventDefault();
          const parsed = accessScheduleSchema.safeParse(value);
          void save(parsed.success ? parsed.data : { ...initial.schedule, enabled: false });
        } else void form.handleSubmit(save)(e);
      }}
    >
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/40 p-4">
        <div>
          <Label htmlFor="schedule-always" className="text-sm font-semibold">
            Pode acessar a qualquer horário
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Sem restrição de dias ou horários, incluindo feriados.
          </p>
        </div>
        <Switch
          id="schedule-always"
          checked={!value.enabled}
          disabled={saving}
          onCheckedChange={(always) => form.setValue('enabled', !always)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Fuso da empresa: <strong className="font-medium text-foreground">{initial.timezone}</strong>
        . Com a restrição ativa, o acesso é bloqueado ao fim do expediente, mesmo com a sessão
        aberta.
      </p>
      <fieldset
        disabled={!value.enabled || saving}
        className="min-w-0 space-y-5 disabled:opacity-50"
      >
        <section aria-labelledby="weekly-heading" className="space-y-3">
          <h3 id="weekly-heading" className="text-base font-semibold">
            Expediente semanal
          </h3>
          <p className="text-sm text-muted-foreground">
            Horários no formato 08:00. Para terminar à meia-noite, use 24:00. Dias desativados não
            permitem acesso.
          </p>
          <div className="divide-y rounded-lg border">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <div key={day} className="grid gap-3 p-3 sm:grid-cols-[160px_1fr]">
                <div className="flex items-center justify-between gap-2 sm:items-start sm:pt-6">
                  <Label htmlFor={`workday-${day}`} className="text-sm">
                    {WEEK_DAYS[day]}
                  </Label>
                  <Switch
                    id={`workday-${day}`}
                    checked={value.weekly[day]!.length > 0}
                    onCheckedChange={(active) =>
                      form.setValue(`weekly.${day}`, active ? regular() : [], {
                        shouldValidate: true,
                      })
                    }
                  />
                </div>
                {value.weekly[day]!.length ? (
                  <Intervals
                    label={WEEK_DAYS[day]!}
                    value={value.weekly[day]!}
                    onChange={(items) =>
                      form.setValue(`weekly.${day}`, items, { shouldValidate: true })
                    }
                    errorAt={(i, key) => errors.weekly?.[day]?.[i]?.[key]?.message}
                  />
                ) : (
                  <p className="py-2 text-sm text-muted-foreground sm:pt-6">Sem expediente</p>
                )}
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="exceptions-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="exceptions-heading" className="text-base font-semibold">
              Exceções por data
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={value.exceptions.length >= 500}
              onClick={() =>
                form.setValue('exceptions', [
                  ...value.exceptions,
                  { date: '', intervals: [], reason: '' },
                ])
              }
            >
              <Plus className="size-4" />
              Adicionar exceção
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Cada exceção substitui o expediente do dia inteiro. Bloqueie feriados ou libere um dia
            extraordinário.
          </p>
          {!value.exceptions.length && (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nenhuma exceção. Valem os horários semanais.
            </p>
          )}
          {errors.exceptions?.message && (
            <p role="alert" className="text-sm text-destructive">
              {errors.exceptions.message}
            </p>
          )}
          {value.exceptions.map((exception, i) => (
            <div key={i} className="space-y-3 rounded-lg border p-3">
              <div className="grid items-start gap-3 sm:grid-cols-[160px_1fr_auto]">
                <label className="min-w-0 text-sm">
                  Data
                  <Input
                    className="mt-1 min-w-0"
                    type="date"
                    aria-label={`Data da exceção ${i + 1}`}
                    value={exception.date}
                    aria-invalid={!!errors.exceptions?.[i]?.date}
                    aria-describedby={
                      errors.exceptions?.[i]?.date ? `exception-date-error-${i}` : undefined
                    }
                    onChange={(e) =>
                      form.setValue(`exceptions.${i}.date`, e.target.value, {
                        shouldValidate: true,
                      })
                    }
                  />
                  {errors.exceptions?.[i]?.date?.message && (
                    <span
                      id={`exception-date-error-${i}`}
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {errors.exceptions[i]!.date!.message}
                    </span>
                  )}
                </label>
                <label className="min-w-0 text-sm">
                  Motivo (opcional)
                  <Input
                    className="mt-1"
                    aria-label={`Motivo da exceção ${i + 1}`}
                    maxLength={160}
                    placeholder="Feriado ou plantão"
                    value={exception.reason}
                    onChange={(e) => form.setValue(`exceptions.${i}.reason`, e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:mt-6"
                  aria-label={`Remover exceção ${i + 1}`}
                  onClick={() =>
                    form.setValue(
                      'exceptions',
                      value.exceptions.filter((_, j) => i !== j),
                      { shouldValidate: true },
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`exception-working-${i}`}>Permitir expediente nesta data</Label>
                <Switch
                  id={`exception-working-${i}`}
                  checked={exception.intervals.length > 0}
                  onCheckedChange={(active) =>
                    form.setValue(`exceptions.${i}.intervals`, active ? regular() : [], {
                      shouldValidate: true,
                    })
                  }
                />
              </div>
              {exception.intervals.length ? (
                <Intervals
                  label={`Exceção ${i + 1}`}
                  value={exception.intervals}
                  onChange={(items) =>
                    form.setValue(`exceptions.${i}.intervals`, items, { shouldValidate: true })
                  }
                  errorAt={(index, key) =>
                    errors.exceptions?.[i]?.intervals?.[index]?.[key]?.message
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem expediente: acesso bloqueado nesta data.
                </p>
              )}
            </div>
          ))}
        </section>
      </fieldset>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {Object.keys(errors).length > 0 && value.enabled && (
        <p role="alert" className="text-sm text-destructive">
          Revise os horários e as datas indicados antes de salvar.
        </p>
      )}
      <div className="sticky -bottom-4 z-10 flex justify-end gap-2 border-t bg-background py-4 sm:-bottom-6">
        <Button type="button" variant="outline" disabled={saving} onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar horário de acesso'}
        </Button>
      </div>
    </form>
  );
}
export function AccessScheduleDialog({
  user,
  onClose,
}: {
  user: { user_id: string; full_name: string };
  onClose: () => void;
}) {
  const tenant = useTenantId();
  const q = useQuery({
    queryKey: ['member-access-schedule', tenant, user.user_id],
    queryFn: () => api<ScheduleResponse>('/members/' + user.user_id + '/access-schedule'),
    retry: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4 pr-10 sm:p-6 sm:pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Clock3 className="size-5" />
            Horário de acesso
          </DialogTitle>
          <DialogDescription>
            {user.full_name} · Defina quando esta pessoa pode entrar e permanecer no APMail.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-6" data-schedule-scroll>
          {q.isLoading ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Carregando horários…
            </p>
          ) : q.isError ? (
            <div role="alert" className="space-y-3">
              <p className="text-sm">Não foi possível carregar os horários.</p>
              <Button variant="outline" onClick={() => void q.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            q.data && <ScheduleForm userId={user.user_id} initial={q.data} onDone={onClose} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
