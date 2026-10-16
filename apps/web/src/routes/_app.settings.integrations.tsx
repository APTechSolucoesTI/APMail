import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Video,
  CalendarDays,
  Plug,
  CheckCircle2,
  ExternalLink,
  Unplug,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import type { GoogleStatus } from '@/components/calendar/online-meeting';
export const Route = createFileRoute('/_app/settings/integrations')({
  validateSearch: z.object({ google: z.enum(['connected', 'cancelled', 'failed']).optional() }),
  component: Integrations,
});
type GoogleEvent = {
  id: string;
  summary?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};
function Integrations() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    search = Route.useSearch(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [disconnect, setDisconnect] = useState(false),
    [preview, setPreview] = useState(false);
  const google = useQuery({
    queryKey: ['google-integration', tenant],
    queryFn: () => api<GoogleStatus>('/integrations/google'),
  });
  const agenda = useQuery({
    queryKey: ['google-calendar', tenant],
    enabled: preview && !!google.data?.calendar,
    queryFn: () => api<GoogleEvent[]>('/integrations/google/calendar/events'),
  });
  const connect = async (calendar = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ url: string }>('/integrations/google/connect', {
        method: 'POST',
        body: { calendar },
      });
      window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (google.isPending) return <LoadingState />;
  if (google.error) return <ErrorState onRetry={() => void google.refetch()} />;
  const data = google.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrações"
        description="Conecte suas ferramentas à sua conta no APMail."
      />
      {search.google === 'connected' && (
        <p role="status" className="rounded-md border bg-secondary px-4 py-3 text-sm">
          Conta Google conectada. Você já pode criar reuniões nos seus eventos.
        </p>
      )}
      {search.google === 'cancelled' && (
        <p role="status" className="rounded-md border px-4 py-3 text-sm">
          A autorização foi cancelada. Nenhuma conexão foi alterada.
        </p>
      )}
      {(search.google === 'failed' || error) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error ||
            'Não foi possível concluir a conexão. Confira a configuração do aplicativo Google e tente novamente.'}
        </p>
      )}
      <section className="max-w-4xl overflow-hidden rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-primary">
              <Plug />
            </div>
            <div>
              <h2 className="font-semibold">Google</h2>
              <p className="text-xs text-muted-foreground">
                {data.connected ? data.email : 'Uma conexão para seus serviços Google'}
              </p>
            </div>
          </div>
          {data.connected ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5" />
                Conectado
              </span>
              <Button variant="ghost" size="sm" onClick={() => setDisconnect(true)}>
                <Unplug />
                Desconectar
              </Button>
            </div>
          ) : (
            <Button disabled={busy || !data.configured} onClick={() => void connect()}>
              Conectar Google
            </Button>
          )}
        </header>
        {!data.configured && (
          <div className="border-b bg-secondary/30 p-4">
            <p className="text-sm font-medium">Configuração do aplicativo necessária</p>
            <p className="mt-1 text-xs text-muted-foreground">
              O administrador precisa configurar o cliente OAuth Google no servidor. Depois, cada
              usuário poderá autorizar sua própria conta.
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              URI de retorno: <code>{data.redirect_uri}</code>
            </p>
          </div>
        )}
        <div className="divide-y">
          <div className="flex flex-wrap items-start gap-3 p-4">
            <Video className="mt-1 size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Google Meet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Crie salas reais diretamente nos eventos e compartilhe o link nos convites e
                lembretes.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {data.meet
                  ? 'Ativo para esta conta. Use Adicionar Meet ao criar ou editar um evento.'
                  : 'Autorize a criação de reuniões ao conectar sua conta.'}
              </p>
            </div>
            {data.connected && !data.meet && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void connect(data.calendar)}
              >
                Autorizar Meet
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-start gap-3 p-4">
            <CalendarDays className="mt-1 size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Google Agenda</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Consulte os próximos eventos da sua agenda principal Google sem sair do APMail.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Permissão opcional de leitura. O calendário interno e os convites por e-mail
                continuam independentes; esta conexão não faz sincronização bidirecional.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !data.configured}
              onClick={() => (data.calendar ? setPreview(!preview) : void connect(true))}
            >
              {data.calendar
                ? preview
                  ? 'Ocultar agenda'
                  : 'Consultar agenda'
                : 'Conectar Agenda'}
            </Button>
          </div>
        </div>
        {preview && data.calendar && (
          <section className="border-t p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">Próximos 90 dias · até 100 eventos</h3>
              <Button
                size="sm"
                variant="ghost"
                disabled={agenda.isFetching}
                onClick={() => void agenda.refetch()}
              >
                <RefreshCw className={agenda.isFetching ? 'animate-spin' : ''} />
                Atualizar
              </Button>
            </div>
            {agenda.isPending ? (
              <LoadingState />
            ) : agenda.error ? (
              <ErrorState onRetry={() => void agenda.refetch()} />
            ) : !agenda.data?.length ? (
              <p className="text-sm text-muted-foreground">Nenhum evento neste período.</p>
            ) : (
              <ul className="divide-y">
                {agenda.data.map((event) => (
                  <li className="flex items-start justify-between gap-3 py-3" key={event.id}>
                    <div>
                      <p className="text-sm font-medium">{event.summary || 'Sem título'}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.start.dateTime
                          ? new Date(event.start.dateTime).toLocaleString('pt-BR')
                          : event.start.date?.split('-').reverse().join('/')}
                      </p>
                    </div>
                    {event.htmlLink?.startsWith('https://calendar.google.com/') && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={event.htmlLink} target="_blank" rel="noopener noreferrer">
                          Abrir
                          <ExternalLink />
                        </a>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </section>
      <ConfirmDialog
        open={disconnect}
        onOpenChange={setDisconnect}
        title="Desconectar conta Google?"
        description="Os links já salvos nos eventos serão preservados. Para criar novas salas, será necessário reconectar."
        pending={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api('/integrations/google', { method: 'DELETE' });
            await client.invalidateQueries({ queryKey: ['google-integration'] });
            client.removeQueries({ queryKey: ['google-calendar'] });
            setPreview(false);
            setDisconnect(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
