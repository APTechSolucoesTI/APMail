import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Video,
  CalendarDays,
  Plug,
  CheckCircle2,
  RefreshCw,
  Unplug,
  ExternalLink,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import {
  GOOGLE_MEET_READ_SCOPE,
  GOOGLE_DRIVE_MEET_SCOPE,
  meetCapabilityLabels,
  type MeetIntegrationStatus,
  type MeetCapability,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { GooglePlans } from './google-plans';
import { GoogleSetup } from './google-setup';
import { MeetPreferencesForm } from './meet-preferences';
import { toast } from 'sonner';
const stateLabels: Record<MeetCapability['state'], string> = {
  available: 'Disponível',
  unavailable: 'Não disponível na conta',
  permission_required: 'Permissão necessária',
  configuration_pending: 'Configuração pendente',
  unverified: 'Não foi possível verificar',
};
export function GoogleIntegration({ result }: { result?: 'connected' | 'cancelled' | 'failed' }) {
  const tenant = useTenantId(),
    client = useQueryClient();
  const google = useQuery({
    queryKey: ['google-integration', tenant],
    queryFn: () => api<MeetIntegrationStatus>('/integrations/google'),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [disconnect, setDisconnect] = useState(false),
    [preview, setPreview] = useState(false);
  const [calendar, setCalendar] = useState(false),
    [otherSpaces, setOtherSpaces] = useState(false),
    [drive, setDrive] = useState(false);
  const agenda = useQuery({
    queryKey: ['google-calendar', tenant],
    enabled: preview && !!google.data?.calendar,
    queryFn: () =>
      api<
        {
          id: string;
          summary?: string;
          htmlLink?: string;
          start: { dateTime?: string; date?: string };
        }[]
      >('/integrations/google/calendar/events'),
  });
  const action = async (path: string, success: string) => {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'POST', body: {} });
      await google.refetch();
      toast.success(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await api<{ url: string }>('/integrations/google/connect', {
        method: 'POST',
        body: {
          calendar: calendar || !!google.data?.calendar,
          reports: otherSpaces || !!google.data?.scopes.includes(GOOGLE_MEET_READ_SCOPE),
          drive: drive || !!google.data?.scopes.includes(GOOGLE_DRIVE_MEET_SCOPE),
        },
      });
      window.location.assign(response.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível conectar.');
      setBusy(false);
    }
  };
  if (google.isPending) return <LoadingState />;
  if (google.isError) return <ErrorState onRetry={() => void google.refetch()} />;
  const data = google.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrações"
        description="Conexões, permissões e preferências dos seus serviços."
      />
      {result === 'connected' && (
        <p
          role="status"
          className="rounded-md border bg-success-bg px-3 py-2 text-sm text-success-fg"
        >
          Conta Google conectada. As permissões efetivamente concedidas aparecem abaixo.
        </p>
      )}
      {result === 'cancelled' && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          A autorização foi cancelada.
        </p>
      )}
      {(error || result === 'failed') && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error ||
            'Não foi possível concluir a conexão. Confira o assistente de configuração e tente novamente.'}
        </p>
      )}
      <section className="overflow-hidden rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-primary">
              <Plug className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Google Meet</h2>
              <p className="text-xs text-muted-foreground">
                {data.email ?? 'Conecte uma conta para criar salas e consultar suas reuniões.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.connected && (
              <>
                <span className="inline-flex items-center gap-1 text-xs text-success-fg">
                  <CheckCircle2 className="size-3.5" />
                  Conectado
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      '/integrations/google/test',
                      'Verificação concluída. Consulte a disponibilidade abaixo.',
                    )
                  }
                >
                  <ShieldCheck />
                  Testar conexão
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDisconnect(true)}
                >
                  <Unplug />
                  Desconectar
                </Button>
              </>
            )}
            <Button size="sm" disabled={busy || !data.configured} onClick={() => void connect()}>
              <RefreshCw />
              {data.connected ? 'Reautorizar permissões' : 'Conectar Google'}
            </Button>
          </div>
        </header>
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold">Serviços e autorizações adicionais</h3>
            <p className="text-xs text-muted-foreground">
              Criação e leitura das salas criadas pelo APMail fazem parte da conexão básica.
            </p>
            {[
              [
                calendar || data.calendar,
                setCalendar,
                'Consultar Google Agenda',
                'Consulta dos próximos eventos, sem sincronização bidirecional.',
              ],
              [
                otherSpaces || data.scopes.includes(GOOGLE_MEET_READ_SCOPE),
                setOtherSpaces,
                'Consultar salas criadas fora do APMail',
                'Permite associar outras salas às quais esta conta tenha acesso.',
              ],
              [
                drive || data.scopes.includes(GOOGLE_DRIVE_MEET_SCOPE),
                setDrive,
                'Ler conteúdo das notas no Google Drive',
                'Opcional. Escopo restrito, sujeito à verificação adicional do Google. Não é necessário para transcrições estruturadas.',
              ],
            ].map(([checked, setter, label, help]) => (
              <label key={String(label)} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={Boolean(checked)}
                  disabled={busy}
                  onCheckedChange={(value) => (setter as (value: boolean) => void)(value === true)}
                />
                <span>
                  {String(label)}
                  <span className="mt-1 block text-xs text-muted-foreground">{String(help)}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Use {data.connected ? 'Reautorizar permissões' : 'Conectar Google'} para conceder as
              opções selecionadas. Permissões já concedidas só são removidas no Google ou ao
              desconectar.
            </p>
          </div>
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <p className="inline-flex items-center gap-2 text-sm font-medium">
              <Video className="size-4 text-primary" />
              Reuniões e relatórios integrados
            </p>
            <p className="text-xs text-muted-foreground">
              A conta Google é pessoal nesta organização. A caixa que envia o convite pode ser
              diferente; quem organiza a sala é a conta Google conectada.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/reports/meet" search={{}}>
                <BarChart3 />
                Abrir relatórios do Meet
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              Última verificação:{' '}
              {data.last_check
                ? new Date(data.last_check).toLocaleString('pt-BR')
                : 'Ainda não realizada'}
            </p>
            <p className="text-xs text-muted-foreground">
              Última sincronização:{' '}
              {data.last_sync?.at
                ? new Date(data.last_sync.at).toLocaleString('pt-BR')
                : 'Ainda não realizada'}
              {data.last_sync?.message && (
                <span className="mt-1 block text-warning-fg">{data.last_sync.message}</span>
              )}
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !data.connected || !data.preferences.sync_enabled}
              onClick={() =>
                void action('/integrations/google/sync', 'Sincronização adicionada à fila.')
              }
            >
              <RefreshCw />
              Sincronizar reuniões
            </Button>
          </div>
        </div>
        {!!Object.keys(data.capabilities).length && (
          <div className="border-t p-4">
            <h3 className="mb-3 text-xs font-semibold">Disponibilidade verificada</h3>
            <div className="grid gap-2 lg:grid-cols-2">
              {Object.entries(data.capabilities).map(([key, value]) => (
                <div key={key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium">{meetCapabilityLabels[key] ?? key}</span>
                    <span
                      className={
                        'rounded border px-1.5 py-0.5 text-xs ' +
                        (value.state === 'available'
                          ? 'bg-success-bg text-success-fg'
                          : 'bg-muted text-muted-foreground')
                      }
                    >
                      {stateLabels[value.state]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{value.message}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Uma consulta autorizada confirma o acesso à API; a geração de gravação, transcrição ou
              notas depende da reunião e dos privilégios do Google.
            </p>
          </div>
        )}
        <details className="border-t px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium">
            Permissões efetivamente concedidas ({data.scopes.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {data.scopes.map((scope) => (
              <li key={scope} className="break-all font-mono">
                {scope}
              </li>
            ))}
            {!data.scopes.length && <li>Nenhuma conta autorizada.</li>}
          </ul>
        </details>
      </section>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <MeetPreferencesForm key={tenant + ':' + data.email} initial={data.preferences} />
        <div className="space-y-4">
          <GoogleSetup redirect={data.redirect_uri} configured={data.configured} />
          <GooglePlans />
          <section className="rounded-lg border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="size-4 text-primary" />
              Google Agenda
            </h2>
            <p className="my-2 text-xs text-muted-foreground">
              Consulta somente de leitura: até 100 eventos dos próximos 90 dias. O calendário
              interno do APMail continua independente.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!data.calendar || agenda.isFetching}
              onClick={() => setPreview(!preview)}
            >
              {preview ? 'Ocultar agenda' : 'Consultar agenda'}
            </Button>
            {preview &&
              (agenda.isPending ? (
                <p role="status" className="mt-3 text-xs">
                  Consultando eventos…
                </p>
              ) : agenda.isError ? (
                <ErrorState onRetry={() => void agenda.refetch()} />
              ) : (
                <ul className="mt-3 divide-y">
                  {agenda.data?.map((event) => (
                    <li key={event.id} className="py-2 text-xs">
                      <p className="font-medium">{event.summary || 'Sem título'}</p>
                      <p className="text-muted-foreground">
                        {event.start.dateTime
                          ? new Date(event.start.dateTime).toLocaleString('pt-BR')
                          : event.start.date}
                      </p>
                      {event.htmlLink?.startsWith('https://') && (
                        <a
                          href={event.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary"
                        >
                          Abrir no Google
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </li>
                  ))}
                  {agenda.data?.length === 0 && (
                    <li className="py-3 text-xs text-muted-foreground">
                      Nenhum evento encontrado.
                    </li>
                  )}
                </ul>
              ))}
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={disconnect}
        onOpenChange={setDisconnect}
        title="Desconectar Google?"
        description="A autorização será revogada e os dados importados dos relatórios desta conexão serão removidos. Eventos, contatos e links de reunião continuam no APMail. Para recuperar dados ainda disponíveis no Google, será necessário conectar novamente."
        destructive
        onConfirm={async () => {
          await api('/integrations/google', { method: 'DELETE' });
          await client.invalidateQueries({ queryKey: ['google-integration'] });
          await client.invalidateQueries({ queryKey: ['meet-reports'] });
          setDisconnect(false);
          toast.success('Conta Google desconectada.');
        }}
      />
    </div>
  );
}
