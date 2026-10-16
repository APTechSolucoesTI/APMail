import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, CalendarDays, ExternalLink, RefreshCw, Video } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import {
  meetDate,
  meetDuration,
  type MeetDetail,
  type MeetSpace,
  type MeetArtifact,
  type TranscriptPage,
} from '@/lib/meet-reports';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import {
  LoadingState,
  ErrorState,
  EmptyState,
  NoPermissionState,
} from '@/components/data/data-state';
import { SearchInput } from '@/components/data/search-input';
import { ReportExport } from '@/components/integrations/report-export';
import { MeetSpaceManager } from '@/components/integrations/meet-space';
export const Route = createFileRoute('/_app/reports_/meet_/$meetingId')({
  component: MeetingDetail,
});
function MeetingDetail() {
  const { meetingId } = Route.useParams(),
    tenant = useTenantId(),
    [busy, setBusy] = useState(false);
  const detail = useQuery({
    queryKey: ['meet-reports', tenant, 'detail', meetingId],
    queryFn: () => api<MeetDetail>('/reports/meet/' + encodeURIComponent(meetingId)),
  });
  const meetingUrl = detail.data?.record?.meeting_url ?? detail.data?.event?.meeting_url;
  const spaces = useQuery({
    queryKey: ['meet-reports', tenant, 'spaces', meetingUrl],
    enabled: !!meetingUrl,
    queryFn: () =>
      api<MeetSpace[]>(
        '/integrations/google/meet/spaces?meeting_url=' + encodeURIComponent(meetingUrl!),
      ),
  });
  if (detail.isPending) return <LoadingState />;
  if (detail.error instanceof ApiError && detail.error.status === 404)
    return (
      <EmptyState
        title="Reunião indisponível"
        description="Este registro não existe ou não está disponível para sua conta."
        action={
          <Button asChild variant="outline">
            <Link to="/reports/meet" search={{}}>
              Voltar às reuniões
            </Link>
          </Button>
        }
      />
    );
  if (detail.error instanceof ApiError && detail.error.status === 403) return <NoPermissionState />;
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;
  const data = detail.data,
    record = data.record,
    event = data.event,
    timezone = event?.timezone ?? 'America/Sao_Paulo',
    url = record?.meeting_url ?? event?.meeting_url;
  const space = spaces.data?.find((s) => s.id === record?.space_id || s.meeting_url === url);
  const path = '/reports/meet/' + encodeURIComponent(meetingId);
  return (
    <div className="space-y-4">
      <Link
        to="/reports/meet"
        search={{}}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Voltar às reuniões
      </Link>
      <PageHeader
        title={record?.title ?? event?.title ?? 'Reunião'}
        description={
          record
            ? 'Conferência registrada pelo Google Meet'
            : 'Evento agendado · sem comprovação de realização'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {event && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/calendar" search={{ event: event.id }}>
                  <CalendarDays />
                  Evento
                </Link>
              </Button>
            )}
            {url && (
              <Button size="sm" variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <Video />
                  Abrir Meet
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !space}
              onClick={async () => {
                if (!space) return;
                setBusy(true);
                try {
                  await api('/integrations/google/meet/spaces/' + space.id + '/sync', {
                    method: 'POST',
                    body: {},
                  });
                  toast.success('Sincronização adicionada à fila.');
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw />
              Sincronizar
            </Button>
            <ReportExport path={path + '/export'} />
          </div>
        }
      />
      {record?.sync_error && (
        <p
          role="alert"
          className="rounded-md border border-warning-fg/30 bg-warning-bg p-3 text-xs text-warning-fg"
        >
          {record.sync_error} Os dados já importados continuam disponíveis.
        </p>
      )}
      <Tabs defaultValue="overview">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList variant="line">
            {[
              ['overview', 'Visão geral'],
              ['participants', 'Participantes'],
              ['timeline', 'Linha do tempo'],
              ['recordings', 'Gravações'],
              ['transcript', 'Transcrição'],
              ['notes', 'Notas da reunião'],
              ['technical', 'Informações técnicas'],
            ].map(([value, label]) => (
              <TabsTrigger key={value} value={value!}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview" className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Organizador do convite', event?.organizer ?? 'Não informado'],
                ['Conta Google', record?.account_email ?? 'Não associada a uma conferência'],
                ['Início agendado', meetDate(event?.starts_at, timezone)],
                ['Início real', meetDate(record?.starts_at, timezone)],
                ['Término real', meetDate(record?.ends_at, timezone)],
                [
                  'Duração real',
                  record?.ends_at
                    ? meetDuration(
                        Math.max(
                          0,
                          (+new Date(record.ends_at) - +new Date(record.starts_at)) / 1000,
                        ),
                      )
                    : 'Não disponível',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Convidados do evento</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Um convite não comprova participação. A participação confirmada pelo Google aparece na
              aba Participantes.
            </p>
            <ul className="mt-3 divide-y">
              {data.attendees.map((attendee) => {
                const contact = data.contacts[attendee.address.toLowerCase()];
                return (
                  <li
                    key={attendee.address}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div>
                      {contact ? (
                        <Link
                          to="/contacts"
                          search={{ contactId: contact.id, page: 1, pageSize: 10, filters: {} }}
                          className="font-medium text-primary hover:underline"
                        >
                          {contact.name}
                        </Link>
                      ) : (
                        <span>{attendee.name || attendee.address}</span>
                      )}
                      <p className="text-xs text-muted-foreground">{attendee.address}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {attendee.status === 'ACCEPTED'
                        ? 'Aceito'
                        : attendee.status === 'DECLINED'
                          ? 'Recusado'
                          : attendee.status === 'TENTATIVE'
                            ? 'Talvez'
                            : 'Convidado'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!data.attendees.length && (
              <p className="mt-3 text-xs text-muted-foreground">
                Nenhum convidado associado no calendário.
              </p>
            )}
          </section>
          {space && (
            <MeetSpaceManager key={space.id + ':' + JSON.stringify(space.config)} space={space} />
          )}
        </TabsContent>
        <TabsContent value="participants" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Reconexões e dispositivos simultâneos são agrupados sem duplicar o tempo de
              participação.
            </p>
            <ReportExport label="Participação" path={path + '/export?report=participants'} />
          </div>
          {!data.participants.length && (
            <Notice
              text={
                record
                  ? phaseMessage(
                      record.artifact_status.participants,
                      'Ainda não há participantes importados.',
                    )
                  : 'A participação ficará disponível quando o Google disponibilizar um registro da conferência.'
              }
            />
          )}
          {data.participants.map((participant) => (
            <article key={participant.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    {participant.display_name || 'Nome não informado'}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {participant.kind === 'phone'
                      ? 'Telefone'
                      : participant.kind === 'anonymous'
                        ? 'Visitante'
                        : 'Conta Google'}{' '}
                    · {participant.sessions.length} sessões
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums">
                  {meetDuration(participant.duration_seconds)}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Primeira entrada</dt>
                  <dd>{meetDate(participant.first_join_at, timezone)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Última saída</dt>
                  <dd>{meetDate(participant.last_leave_at, timezone)}</dd>
                </div>
              </dl>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-primary">Ver sessões</summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {participant.sessions.map((session) => (
                    <li key={session.id}>
                      {meetDate(session.starts_at, timezone)} →{' '}
                      {session.ends_at
                        ? meetDate(session.ends_at, timezone)
                        : 'Saída não informada'}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </TabsContent>
        <TabsContent value="timeline">
          <section className="rounded-lg border bg-card p-4">
            {data.timeline.length ? (
              <ol className="space-y-4 border-l pl-4">
                {data.timeline.map((entry, index) => (
                  <li key={index}>
                    <p className="text-sm">{entry.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {meetDate(entry.at, timezone)} · {entry.source}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <Notice text="Nenhum evento de conferência recuperado. Agendamentos não são apresentados como atividades realizadas." />
            )}
          </section>
        </TabsContent>
        <TabsContent value="recordings">
          <Artifacts
            artifacts={data.artifacts.filter((a) => a.kind === 'recording')}
            empty={
              record
                ? phaseMessage(
                    record.artifact_status.recordings,
                    'Nenhuma gravação foi disponibilizada nesta consulta. O arquivo pode estar em processamento ou fora da permissão da conta.',
                  )
                : 'A reunião ainda não possui um registro de conferência importado.'
            }
          />
        </TabsContent>
        <TabsContent value="transcript" className="space-y-4">
          <Artifacts
            artifacts={data.artifacts.filter((a) => a.kind === 'transcript')}
            empty={
              record
                ? phaseMessage(
                    record.artifact_status.transcripts,
                    'Nenhuma transcrição foi disponibilizada. A geração depende dos recursos da conta e da reunião.',
                  )
                : 'Sem conferência importada para consultar a transcrição.'
            }
          />
          {record && <Transcript key={record.id} id={record.id} path={path} timezone={timezone} />}
        </TabsContent>
        <TabsContent value="notes">
          <Artifacts
            artifacts={data.artifacts.filter((a) => a.kind === 'smart_notes')}
            empty={
              record
                ? phaseMessage(
                    record.artifact_status.smartNotes,
                    'Nenhuma nota inteligente foi disponibilizada pelo Google. Nenhum resumo foi gerado pelo APMail.',
                  )
                : 'Sem conferência importada para consultar notas.'
            }
          />
        </TabsContent>
        <TabsContent value="technical">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              {[
                ['Conferência Google', record?.resource_name ?? 'Não disponível'],
                ['Sala Google', record?.space_resource ?? space?.resource_name ?? 'Não associada'],
                [
                  'Última sincronização',
                  meetDate(record?.last_sync_at ?? space?.last_sync_at, timezone),
                ],
                ['Fonte', record ? 'Google Meet REST API v2' : 'Calendário interno APMail'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <h2 className="text-sm font-semibold">Disponibilidade e privacidade</h2>
            <ul className="list-disc space-y-2 pl-4 text-xs text-muted-foreground">
              {data.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <Link
              to="/settings/integrations"
              className="inline-block text-xs text-primary underline"
            >
              Gerenciar consentimento e retenção
            </Link>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
function phaseMessage(value: { state?: string; message?: string } | undefined, fallback: string) {
  return (
    value?.message ??
    (value?.state === 'processing'
      ? 'Sincronização em andamento. Os dados serão atualizados automaticamente.'
      : fallback)
  );
}
function Notice({ text }: { text: string }) {
  return <p className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">{text}</p>;
}
function Artifacts({ artifacts, empty }: { artifacts: MeetArtifact[]; empty: string }) {
  return (
    <div className="space-y-3">
      {!artifacts.length && <Notice text={empty} />}
      {artifacts.map((artifact) => (
        <article key={artifact.id} className="space-y-2 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {artifact.kind === 'recording'
                ? 'Gravação'
                : artifact.kind === 'transcript'
                  ? 'Transcrição'
                  : 'Notas inteligentes'}
            </h2>
            <span className="rounded border bg-muted px-1.5 py-0.5 text-xs">
              {artifact.state === 'FILE_GENERATED'
                ? 'Arquivo disponível'
                : artifact.state === 'STARTED'
                  ? 'Em geração'
                  : artifact.state === 'ENDED'
                    ? 'Processando arquivo'
                    : 'Estado não informado'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{meetDate(artifact.starts_at)}</p>
          {artifact.external_url && (
            <a
              href={artifact.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Abrir documento original no Google
              <ExternalLink className="size-3" />
            </a>
          )}
          {artifact.entries_error && (
            <p role="alert" className="text-xs text-warning-fg">
              {artifact.entries_error}
            </p>
          )}
          {artifact.body_text && (
            <div className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm leading-relaxed">
              {artifact.body_text}
            </div>
          )}
          {artifact.kind === 'smart_notes' && !artifact.body_text && (
            <p className="text-xs text-muted-foreground">
              O texto pode ser consultado no documento original. A importação do conteúdo exige
              autorização adicional do Google Drive.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
function Transcript({ id, path, timezone }: { id: string; path: string; timezone: string }) {
  const tenant = useTenantId(),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ['meet-reports', tenant, 'transcript', id, search, page],
    queryFn: ({ signal }) =>
      api<TranscriptPage>(
        path + '/transcript?' + new URLSearchParams({ search, page: String(page) }),
        { signal },
      ),
  });
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Pesquisar na transcrição…"
        />
        <ReportExport transcript path={path + '/export?report=transcript'} />
      </div>
      {result.isPending ? (
        <LoadingState />
      ) : result.isError ? (
        <ErrorState onRetry={() => void result.refetch()} />
      ) : (
        <>
          {!result.data.items.length && (
            <Notice
              text={
                search
                  ? 'Nenhum trecho encontrado para esta pesquisa.'
                  : 'Nenhum trecho importado. A transcrição pode estar em processamento, sem autorização ou fora da janela de disponibilidade do Google.'
              }
            />
          )}
          <ol className="divide-y">
            {result.data.items.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold">
                    {entry.display_name || 'Participante não identificado'}
                  </span>
                  <time className="text-muted-foreground" dateTime={entry.starts_at}>
                    {meetDate(entry.starts_at, timezone)}
                  </time>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry.body_text}</p>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-end gap-3 text-xs">
            <span>Página {page}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!result.data.hasMore}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
