import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isTenantAdmin, type ListQuery } from '@apmail/shared';
import {
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ScanLine,
  FileCheck2,
  ShieldOff,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import {
  type AntivirusFile,
  type AntivirusOverview,
  type ReleaseTarget,
  antivirusExplanation,
  attachmentCanOpen,
} from '@/lib/antivirus';
import { FileReleaseDialog } from './file-release-dialog';
import { SenderTrustSettings } from './sender-trust-settings';
import { AntivirusDecisions } from './antivirus-decisions';
import { MailActionButton } from '@/components/mail/mail-action-button';
import { AttachmentSafetyBadge } from '@/components/mail/attachment-safety';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
} from '@/components/data/data-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type Mode = 'files' | 'threats' | 'history' | 'trust' | 'decisions';
const healthLabels = {
  online: 'Online',
  offline: 'Offline',
  error: 'Falha de comunicação',
  unavailable: 'Indisponível',
};
const statusLabels = {
  all: 'Todos os estados',
  pending: 'Pendentes',
  clean: 'Verificados',
  infected: 'Bloqueados',
  error: 'Falhas de verificação',
  released: 'Liberados por confiança',
  blocked: 'Bloqueados atualmente',
};
export function AntivirusPanel({ query }: { query: ListQuery }) {
  const tenant = useTenantId();
  const me = useQuery(meQuery).data;
  const admin = isTenantAdmin(me?.tenants.find((t) => t.id === me.current_tenant_id)?.role);
  const navigate = useNavigate();
  const client = useQueryClient();
  const timezone = me?.preferences.timezone ?? 'America/Sao_Paulo';
  const [mode, setMode] = useState<Mode>('files');
  const [selection, setSelection] = useState<string[]>([]);
  const [release, setRelease] = useState<{ targets: ReleaseTarget[]; revoke: boolean } | null>(
    null,
  );
  const target = (row: AntivirusFile): ReleaseTarget => ({
    ...row,
    id: row.file_id ?? row.id,
    mailbox_id: row.mailbox?.id,
  });
  const eligible = (row: AntivirusFile) =>
    !!row.file_id &&
    ['attachment', 'upload'].includes(row.kind) &&
    ['infected', 'error'].includes(row.status);
  const [backfill, setBackfill] = useState<'unverified' | 'failed' | null>(null);
  const [limit, setLimit] = useState<10 | 50 | 100 | 500>(50);
  const status = mode === 'threats' ? 'blocked' : (query.filters.status?.[0] ?? 'all');
  const parameters = new URLSearchParams({
    page: String(query.page),
    page_size: String(query.pageSize),
    ...(query.search ? { search: query.search } : {}),
    ...(mode !== 'history' ? { status } : {}),
  });
  const overview = useQuery({
    queryKey: ['antivirus-overview', tenant],
    queryFn: ({ signal }) => api<AntivirusOverview>('/security/antivirus/overview', { signal }),
    enabled: admin,
    refetchInterval: 15000,
  });
  const files = useQuery({
    queryKey: ['antivirus-files', tenant, mode, parameters.toString()],
    queryFn: ({ signal }) =>
      api<{ items: AntivirusFile[]; total: number }>(
        '/security/antivirus/' + (mode === 'history' ? 'history' : 'files') + '?' + parameters,
        { signal },
      ),
    enabled: admin && ['files', 'threats', 'history'].includes(mode),
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
  });
  const change = (value: ListQuery) => void navigate({ to: '/security/antivirus', search: value });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['antivirus-overview', tenant] }),
      client.invalidateQueries({ queryKey: ['antivirus-files', tenant] }),
      client.invalidateQueries({ queryKey: ['attachment-security', tenant] }),
    ]);
  };
  const rescan = useMutation({
    mutationFn: (id: string) =>
      api('/security/antivirus/files/' + id + '/rescan', { method: 'POST', body: {} }),
    onSuccess: async () => {
      await refresh();
      toast.success('Arquivo na fila de verificação.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString('pt-BR', { timeZone: timezone }) : 'Não disponível';
  if (!admin) return <NoPermissionState />;
  const health = overview.data?.health;
  return (
    <>
      <PageHeader
        title="Antivírus"
        description="Proteção dos anexos da empresa e histórico de verificações."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={overview.isFetching || files.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCw aria-hidden className="size-4" />
              Atualizar
            </Button>
            <Button onClick={() => setBackfill('unverified')}>
              <ScanLine aria-hidden className="size-4" />
              Verificar pendentes
            </Button>
          </div>
        }
      />
      {overview.isPending ? (
        <LoadingState />
      ) : overview.isError ? (
        <ErrorState onRetry={() => void overview.refetch()} />
      ) : (
        health && (
          <section aria-label="Estado do antivírus" className="mb-4 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <ShieldCheck aria-hidden className="size-5 text-primary" />
                  Motor ClamAV
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Última consulta: {date(health.checked_at)}
                </p>
              </div>
              <StatusBadge
                label={healthLabels[health.status]}
                variant={health.status === 'online' ? 'success' : 'danger'}
                icon={health.status === 'online' ? ShieldCheck : ShieldAlert}
              />
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Detalhes do motor · {health.engine_version ?? 'versão indisponível'}
              </summary>
              <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Versão do motor</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {health.engine_version ?? 'Não disponível'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Versão das assinaturas</dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {health.signature_version ?? 'Não disponível'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Atualização das assinaturas</dt>
                  <dd className="mt-1 text-sm">{date(health.definitions_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Idade das assinaturas</dt>
                  <dd className="mt-1 text-sm">
                    {health.age_hours == null
                      ? 'Não disponível'
                      : `${Math.round(health.age_hours)} horas`}
                    {health.stale && <span className="ml-2 text-warning-fg">Desatualizadas</span>}
                  </dd>
                </div>
              </dl>
            </details>
            {(health.status !== 'online' || health.stale) && (
              <p
                role="status"
                className="mt-4 rounded-md border border-warning/30 bg-warning-bg p-3 text-sm text-warning-fg"
              >
                {health.status !== 'online'
                  ? 'O motor não está disponível. Arquivos sem verificação continuam bloqueados; o processamento será retomado quando a conexão voltar.'
                  : 'As assinaturas precisam de atualização. Confira a atualização do serviço antes de iniciar novas verificações.'}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ['total', 'Arquivos'],
                  ['pending', 'Pendentes'],
                  ['clean', 'Verificados'],
                  ['blocked', 'Bloqueados'],
                  ['error', 'Falhas'],
                  ['released', 'Liberados por confiança'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {(
                      overview.data.counts[key] ??
                      (key === 'blocked' ? overview.data.counts.infected : 0)
                    ).toLocaleString('pt-BR')}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Visualização do antivírus" className="flex flex-wrap gap-1">
          {(
            [
              ['files', 'Arquivos'],
              ['threats', 'Ameaças e bloqueios'],
              ['history', 'Histórico'],
              ['trust', 'Remetentes confiáveis'],
              ['decisions', 'Liberações e decisões'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={mode === value ? 'secondary' : 'ghost'}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setSelection([]);
                change({ ...query, page: 1 });
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'files' && (
            <>
              <Label htmlFor="antivirus-status">Estado</Label>
              <select
                id="antivirus-status"
                className="h-11 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
                value={status}
                onChange={(event) =>
                  change({
                    ...query,
                    page: 1,
                    filters: { ...query.filters, status: [event.target.value] },
                  })
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          {['files', 'threats', 'history'].includes(mode) && (
            <Button variant="outline" onClick={() => setBackfill('failed')}>
              Repetir falhas
            </Button>
          )}
        </div>
      </div>
      {['files', 'threats', 'history'].includes(mode) && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {mode === 'history'
              ? 'Cada linha preserva o resultado de uma análise. Uma nova verificação não apaga resultados anteriores.'
              : 'Bloqueios por senha e limites são preventivos. Selecione anexos para liberar, registrar um possível falso positivo ou revogar uma liberação. O resultado original permanece no histórico.'}{' '}
            Horários em {timezone}.
          </p>
          <ConfigurableTable<AntivirusFile>
            listKey={'antivirus-' + mode + '-v1'}
            mode="server"
            query={query}
            onQueryChange={change}
            selectable={mode !== 'history'}
            selectedIds={selection}
            onSelectionChange={setSelection}
            bulkActions={(ids) => {
              const selected = (files.data?.items ?? []).filter(
                (row) => ids.includes(row.id) && eligible(row),
              );
              const blocked = selected.filter((row) => !attachmentCanOpen(row));
              const approved = selected.filter(attachmentCanOpen);
              return (
                <>
                  <Button
                    size="sm"
                    disabled={!blocked.length}
                    onClick={() => setRelease({ targets: blocked.map(target), revoke: false })}
                  >
                    <FileCheck2 className="size-4" />
                    Liberar {blocked.length} anexo(s)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!approved.length}
                    onClick={() => setRelease({ targets: approved.map(target), revoke: true })}
                  >
                    <ShieldOff className="size-4" />
                    Revogar {approved.length}
                  </Button>
                  {selected.length < ids.length && (
                    <span className="text-xs text-muted-foreground">
                      {ids.length - selected.length} arquivo(s) sem bloqueio elegível.
                    </span>
                  )}
                </>
              );
            }}
            data={files.data?.items ?? []}
            total={files.data?.total ?? 0}
            isLoading={files.isLoading}
            isFetching={files.isFetching}
            error={files.error}
            onRetry={() => void files.refetch()}
            searchPlaceholder="Buscar nome do arquivo ou ameaça…"
            emptyState={
              <EmptyState
                icon={ShieldCheck}
                title={
                  mode === 'history'
                    ? 'Nenhuma verificação registrada'
                    : mode === 'threats'
                      ? 'Nenhuma ameaça ou bloqueio'
                      : 'Nenhum arquivo encontrado'
                }
                description={
                  mode === 'history'
                    ? 'Os resultados aparecerão após o processamento dos anexos.'
                    : 'Os anexos recebidos e enviados serão acompanhados nesta área.'
                }
              />
            }
            columns={[
              {
                id: 'filename',
                header: 'Arquivo',
                sortable: false,
                cell: (row) => (
                  <div className="max-w-80">
                    <p className="truncate font-medium" title={row.filename}>
                      {row.filename}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(
                        {
                          upload: 'Anexo de composição',
                          attachment: 'Anexo de mensagem',
                          signature_image: 'Imagem de assinatura',
                          avatar: 'Foto de perfil',
                          mail_import: 'Arquivo de importação',
                          mail_export: 'Backup exportado',
                          mail_raw: 'Mensagem original',
                        } as Record<string, string>
                      )[row.kind] ?? 'Arquivo'}{' '}
                      · {Math.ceil(row.size_bytes / 1024).toLocaleString('pt-BR')} KB
                    </p>
                  </div>
                ),
              },
              {
                id: 'status',
                header: 'Resultado',
                sortable: false,
                cell: (row) => (
                  <div className="max-w-80 space-y-1">
                    <AttachmentSafetyBadge security={row} />
                    {row.status !== 'clean' && (
                      <p
                        className="line-clamp-2 max-w-72 whitespace-normal break-words text-xs text-muted-foreground"
                        title={antivirusExplanation(row)}
                      >
                        {row.access_allowed
                          ? 'Acesso autorizado. Resultado original preservado.'
                          : antivirusExplanation(row)}
                      </p>
                    )}
                    {row.threat_name && (
                      <p
                        className="line-clamp-2 max-w-72 whitespace-normal break-all font-mono text-xs"
                        title={row.threat_name}
                      >
                        {row.threat_name}
                      </p>
                    )}
                    {row.false_positive && (
                      <p className="text-xs text-primary">Possível falso positivo</p>
                    )}
                  </div>
                ),
              },
              {
                id: 'mailbox',
                header: 'Caixa de e-mail',
                sortable: false,
                cell: (row) => (
                  <span title={row.mailbox?.email_address}>
                    {row.mailbox?.name ?? 'Sem caixa vinculada'}
                  </span>
                ),
              },
              {
                id: 'subject',
                header: 'Mensagem',
                sortable: false,
                defaultVisible: false,
                cell: (row) => (
                  <span title={row.message?.subject}>
                    {row.message?.subject || 'Sem mensagem vinculada'}
                  </span>
                ),
              },
              {
                id: 'scanned_at',
                header: 'Última análise',
                sortable: false,
                cell: (row) => (
                  <span className="whitespace-nowrap tabular-nums">{date(row.scanned_at)}</span>
                ),
              },
              {
                id: 'engine_version',
                header: 'Motor',
                sortable: false,
                defaultVisible: false,
                cell: (row) => row.engine_version ?? 'Não disponível',
              },
              {
                id: 'definitions_at',
                header: 'Assinaturas utilizadas',
                sortable: false,
                defaultVisible: false,
                cell: (row) => date(row.definitions_at),
              },
            ]}
            rowActions={(row) => (
              <div className="flex">
                {mode !== 'history' && eligible(row) && (
                  <MailActionButton
                    iconOnly
                    label={
                      (attachmentCanOpen(row) ? 'Revogar liberação de ' : 'Liberar ') + row.filename
                    }
                    onClick={() =>
                      setRelease({ targets: [target(row)], revoke: attachmentCanOpen(row) })
                    }
                  >
                    {attachmentCanOpen(row) ? <ShieldOff /> : <FileCheck2 />}
                  </MailActionButton>
                )}
                {row.mailbox && row.message?.thread_id && (
                  <MailActionButton
                    iconOnly
                    label={'Abrir e-mail de ' + row.filename}
                    onClick={() =>
                      void navigate({
                        to: '/mail/$mailboxId',
                        params: { mailboxId: row.mailbox!.id },
                        search: { thread: row.message!.thread_id },
                      })
                    }
                  >
                    <ExternalLink />
                  </MailActionButton>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={'Reanalisar ' + row.filename}
                  disabled={rescan.isPending || (mode === 'history' && !row.file_id)}
                  onClick={() => rescan.mutate(mode === 'history' ? row.file_id! : row.id)}
                >
                  <RefreshCw
                    aria-hidden
                    className={
                      'size-4 ' +
                      (rescan.isPending && rescan.variables === (row.file_id ?? row.id)
                        ? 'animate-spin motion-reduce:animate-none'
                        : '')
                    }
                  />
                </Button>
              </div>
            )}
          />
        </>
      )}
      {mode === 'trust' && <SenderTrustSettings query={query} onQueryChange={change} />}
      {mode === 'decisions' && <AntivirusDecisions query={query} onQueryChange={change} />}
      {release && (
        <FileReleaseDialog
          targets={release.targets}
          revoke={release.revoke}
          onClose={() => {
            setRelease(null);
            setSelection([]);
          }}
        />
      )}
      <ConfirmDialog
        open={backfill !== null}
        onOpenChange={(open) => {
          if (!open) setBackfill(null);
        }}
        title={
          backfill === 'failed'
            ? 'Repetir verificações com falha?'
            : 'Verificar arquivos pendentes?'
        }
        description="A operação adiciona um lote limitado à fila da empresa. Nenhum arquivo será excluído ou liberado sem verificação."
        onConfirm={async () => {
          const result = await api<{ queued: number }>('/security/antivirus/backfill', {
            method: 'POST',
            body: { limit, scope: backfill ?? 'unverified' },
          });
          await refresh();
          toast.success(`${result.queued} arquivos adicionados à fila.`);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="antivirus-limit">Máximo de arquivos neste lote</Label>
          <select
            id="antivirus-limit"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) as 10 | 50 | 100 | 500)}
          >
            {[10, 50, 100, 500].map((value) => (
              <option key={value} value={value}>
                {value} arquivos
              </option>
            ))}
          </select>
        </div>
      </ConfirmDialog>
    </>
  );
}
