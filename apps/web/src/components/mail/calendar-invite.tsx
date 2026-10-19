import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Video } from 'lucide-react';
import type { CalendarInvite } from '@apmail/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import type { CalendarEvent } from '@/lib/calendar';
export function CalendarInvitation({
  messageId,
  timeZone,
  canSend,
}: {
  messageId: string;
  timeZone: string;
  canSend: boolean;
}) {
  const tenant = useTenantId(),
    client = useQueryClient();
  const info = useQuery({
    queryKey: ['calendar', tenant, 'invitation', messageId],
    queryFn: () =>
      api<{ invite: CalendarInvite; event: CalendarEvent | null }>(
        '/messages/' + messageId + '/calendar',
      ),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (info.isPending)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Carregando convite…
      </p>
    );
  if (info.error)
    return (
      <div role="alert" className="text-sm text-destructive">
        Não foi possível carregar o convite.{' '}
        <Button size="sm" variant="ghost" onClick={() => void info.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  const { invite, event } = info.data;
  const respond = async (status: string) => {
    setBusy(true);
    setError('');
    try {
      await api('/messages/' + messageId + '/calendar/respond', {
        method: 'POST',
        body: { status },
      });
      await client.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const date = (value: string) =>
    new Date(value).toLocaleString('pt-BR', {
      timeZone: invite.all_day ? 'UTC' : timeZone,
      dateStyle: 'medium',
      ...(invite.all_day ? {} : { timeStyle: 'short' }),
    });
  return (
    <section
      className="space-y-2 rounded-md border bg-secondary/40 p-3"
      aria-label="Convite de calendário"
    >
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">
            {invite.method === 'CANCEL'
              ? 'Reunião cancelada'
              : invite.method === 'REPLY'
                ? 'Resposta de participação'
                : invite.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {date(invite.starts_at)} —{' '}
            {date(
              invite.all_day
                ? new Date(+new Date(invite.ends_at) - 86400000).toISOString()
                : invite.ends_at,
            )}
            {invite.location ? ' · ' + invite.location : ''}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {invite.organizer
              ? 'Organizador: ' + invite.organizer
              : 'Compromisso recebido por e-mail'}
            {invite.rrule ? ' · Evento recorrente' : ''}
          </p>
        </div>
      </div>
      {event && (
        <p role="status" className="text-xs text-muted-foreground">
          {event.status === 'cancelled'
            ? 'Evento recusado ou cancelado.'
            : 'Adicionado ao seu calendário.'}{' '}
          <a href="/calendar" className="text-primary underline">
            Abrir calendário
          </a>
        </p>
      )}
      {invite.meeting_url && (
        <Button asChild size="sm" variant="outline">
          <a href={invite.meeting_url} target="_blank" rel="noopener noreferrer">
            <Video />
            Entrar na reunião
          </a>
        </Button>
      )}
      {invite.method === 'PUBLISH' && !event && (
        <Button size="sm" disabled={busy} onClick={() => void respond('ACCEPTED')}>
          {busy ? 'Aguarde…' : 'Adicionar ao calendário'}
        </Button>
      )}
      {invite.method === 'REQUEST' && !event && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !canSend} onClick={() => void respond('ACCEPTED')}>
            {busy ? 'Aguarde…' : 'Aceitar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !canSend}
            onClick={() => void respond('DECLINED')}
          >
            Recusar
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
