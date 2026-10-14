import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recurrenceLabel, type Recurrence } from '@apmail/shared';
import { Repeat2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, useUserId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
type Series = Recurrence & {
  id: string;
  subject: string;
  next_at: string | null;
  last_error: string | null;
  sent_count: number;
  latest_status: string;
  mailbox_id: string;
};
export function RecurringSchedules({ mailboxId }: { mailboxId?: string }) {
  const tenant = useTenantId(),
    user = useUserId(),
    client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['recurring-schedules', tenant, user],
    queryFn: () => api<Series[]>('/outbox/recurrences'),
    refetchInterval: 10000,
  });
  if (query.isLoading)
    return (
      <p role="status" className="mb-4 text-sm text-muted-foreground">
        Consultando recorrências…
      </p>
    );
  if (query.error)
    return (
      <div role="alert" className="mb-4 text-sm text-destructive">
        Não foi possível consultar os envios recorrentes.{' '}
        <Button variant="ghost" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  const rows = query.data?.filter((row) => !mailboxId || row.mailbox_id === mailboxId) ?? [];
  if (!rows.length) return null;
  return (
    <section className="mb-4 space-y-3" aria-label="Envios recorrentes">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Repeat2 className="size-4" aria-hidden />
        Envios recorrentes
      </h2>
      {rows.map((row) => (
        <article
          key={row.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card p-3"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="break-words text-sm font-semibold">{row.subject || '(Sem assunto)'}</h3>
            <p className="text-sm">
              {recurrenceLabel(row)} · {row.sent_count}
              {row.max_occurrences ? ' de ' + row.max_occurrences : ''} envios concluídos
            </p>
            <p className="text-xs text-muted-foreground">
              {row.next_at
                ? 'Próximo: ' +
                  new Date(row.next_at).toLocaleString('pt-BR', {
                    timeZone: row.timezone,
                    timeZoneName: 'short',
                  })
                : row.latest_status === 'sending'
                  ? 'Envio em processamento'
                  : row.latest_status === 'failed'
                    ? 'Retome o envio na aba Com falha para continuar.'
                    : 'Preparando próximo envio'}
            </p>
            {row.last_error && (
              <p role="alert" className="text-sm text-destructive">
                {row.last_error}
              </p>
            )}
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" disabled={busy}>
                Parar recorrência
              </Button>
            }
            title="Parar os próximos envios?"
            description="Os próximos envios desta recorrência serão cancelados. E-mails já enviados ficam preservados. Um envio que já começou pode concluir."
            onConfirm={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await api('/outbox/recurrences/' + row.id + '/cancel', { method: 'POST' });
                await Promise.all([
                  client.invalidateQueries({ queryKey: ['recurring-schedules'] }),
                  client.invalidateQueries({ queryKey: ['outbox'] }),
                ]);
                toast.success('Recorrência interrompida.');
              } finally {
                setBusy(false);
              }
            }}
          />
        </article>
      ))}
    </section>
  );
}
