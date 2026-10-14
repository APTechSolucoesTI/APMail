import { useRef, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Play, X, Settings2, Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  listQuerySchema,
  MAIL_ARCHIVE_MAX_BYTES,
  mailArchiveFormat,
  type MailArchiveTask,
  type TenantQuota,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { archiveFingerprint } from '@/lib/mail-archive-upload';
import {
  clearArchiveTransfer,
  interruptArchiveTransfer,
  startArchiveTransfer,
  useArchiveTransfers,
} from '@/lib/mail-archive-transfers';
import { useTenantId, useUserId } from '@/lib/auth';
import { formatStorageBytes } from '@/lib/storage-metering';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge, type StatusVariant } from '@/components/common/status-badge';
import { StorageUsageBar } from '@/components/storage/storage-quotas';
import { PstExportJobs, usePstExportJobs } from './pst-export-jobs';
type Admission = {
  near_limit: boolean;
  tenant_remaining_bytes: string | null;
  mailbox_remaining_bytes: string | null;
  warning: string | null;
};
const states: Record<string, string> = {
  uploading: 'Envio incompleto',
  queued: 'Na fila',
  running: 'Importando',
  paused: 'Pausada pela cota',
  completed: 'Concluída',
  failed: 'Falha',
  cancelled: 'Cancelada',
};
const stateVariants: Record<string, StatusVariant> = {
  uploading: 'neutral',
  queued: 'neutral',
  running: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
export function MailArchivesPanel({ mailboxId }: { mailboxId: string }) {
  const tenant = useTenantId(),
    user = useUserId(),
    client = useQueryClient();
  const [file, setFile] = useState<File | null>(null),
    [admission, setAdmission] = useState<Admission | null>(null),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(false),
    [progress, setProgress] = useState(0),
    [exportFormat, setExportFormat] = useState('mbox'),
    [query, setQuery] = useState(() => listQuerySchema.parse({}));
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [uploadTask, setUploadTask] = useState<MailArchiveTask | null>(null);
  const selection = useRef(0),
    fileInput = useRef<HTMLInputElement | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [creatingPst, setCreatingPst] = useState(false);
  const pstExports = usePstExportJobs(mailboxId);
  const generatingPst = pstExports.data?.some((task) =>
    ['queued', 'staging', 'converting'].includes(task.state),
  );
  const transfers = useArchiveTransfers();
  const scope = tenant && user ? { tenantId: tenant, userId: user, mailboxId } : null;
  const transfer = transfers.find(
    (t) =>
      t.scope.tenantId === tenant && t.scope.userId === user && t.scope.mailboxId === mailboxId,
  );
  const busy = transfer?.status === 'sending';
  const selectedFile = file ?? transfer?.file ?? null;
  const selectedFingerprint = fingerprint ?? transfer?.fingerprint ?? null;
  useEffect(
    () => () => {
      selection.current++;
    },
    [],
  );
  const tasks = useQuery({
    queryKey: ['mail-archives', tenant, user, mailboxId],
    queryFn: () => api<MailArchiveTask[]>('/mailboxes/' + mailboxId + '/archive-imports'),
    refetchInterval: 5000,
  });
  const capacity = useQuery({
    queryKey: ['storage-quota', 'tenant', tenant],
    queryFn: ({ signal }) => api<TenantQuota>('/tenant/storage', { signal }),
    refetchInterval:
      busy || tasks.data?.some((t) => ['queued', 'running'].includes(t.state)) ? 5000 : 30000,
  });
  const boxCapacity = capacity.data?.mailboxes.find((b) => b.mailbox_id === mailboxId);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['mail-archives', tenant, user, mailboxId] });
    await client.invalidateQueries({ queryKey: ['storage-quota'] });
  };
  const choose = async (value: File | null) => {
    if (scope) clearArchiveTransfer(scope);
    const version = ++selection.current;
    setFile(value);
    setUploadTask(null);
    setFingerprint(null);
    setProgress(0);
    setAdmission(null);
    setError('');
    setChecking(false);
    if (!value) return;
    if (!mailArchiveFormat(value.name)) {
      setError('Selecione PST, OST, MBOX, EML, EMLX ou ZIP com mensagens.');
      return;
    }
    if (value.size <= 0 || value.size > MAIL_ARCHIVE_MAX_BYTES) {
      setError('O arquivo deve ter conteúdo e no máximo 20 GiB.');
      return;
    }
    setChecking(true);
    try {
      const hash = await archiveFingerprint(value);
      const existing = await api<MailArchiveTask[]>('/mailboxes/' + mailboxId + '/archive-imports');
      const pending = existing.find(
        (task) =>
          task.state === 'uploading' &&
          task.upload_fingerprint === hash &&
          task.filename === value.name &&
          Number(task.size_bytes) === value.size,
      );
      if (version !== selection.current) return;
      setFingerprint(hash);
      setUploadTask(pending ?? null);
      setProgress(Math.floor((Number(pending?.uploaded_bytes ?? 0) * 100) / value.size));
      const result = await api<Admission>(
        '/mailboxes/' + mailboxId + '/archive-imports/preflight',
        {
          method: 'POST',
          body: {
            filename: value.name,
            size_bytes: value.size - Number(pending?.uploaded_bytes ?? 0),
          },
        },
      );
      if (version === selection.current) setAdmission(result);
    } catch (e) {
      if (version === selection.current)
        setError(e instanceof Error ? e.message : 'Não foi possível verificar a cota.');
    } finally {
      if (version === selection.current) setChecking(false);
    }
  };
  const upload = async () => {
    if (!scope || !selectedFile || !selectedFingerprint || busy) return;
    setError('');
    const sending = startArchiveTransfer(
      scope,
      selectedFile,
      selectedFingerprint,
      uploadTask ?? transfer?.task ?? null,
    );
    setFile(null);
    setUploadTask(null);
    setFingerprint(null);
    setAdmission(null);
    if (fileInput.current) fileInput.current.value = '';
    await sending.catch(() => undefined);
  };
  const action = async (id: string, name: string) => {
    if (acting) return;
    setActing(id);
    try {
      await api('/mailboxes/' + mailboxId + '/archive-imports/' + id + '/' + name, {
        method: 'POST',
      });
      await refresh();
    } finally {
      setActing(null);
    }
  };
  return (
    <section className="space-y-6" aria-label="Importação e backup de e-mails">
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Capacidade para importar</h2>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/tenant" hash="storage-allocation">
              <Settings2 aria-hidden />
              Gerenciar armazenamento
            </Link>
          </Button>
        </div>
        {capacity.data && boxCapacity ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <StorageUsageBar
              label="APMail: esta caixa"
              used={boxCapacity.used_bytes}
              limit={boxCapacity.allocated_bytes}
            />
            <StorageUsageBar
              label="APMail: empresa"
              used={capacity.data.used_bytes}
              limit={capacity.data.storage_limit_bytes}
            />
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {capacity.error ? 'Não foi possível atualizar o consumo.' : 'Consultando consumo…'}
            {capacity.error && (
              <Button variant="ghost" size="sm" onClick={() => void capacity.refetch()}>
                Tentar novamente
              </Button>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Consumo real: arquivo de origem, mensagens, anexos e dados do sistema. O arquivo de origem
          é liberado ao concluir ou cancelar. A exclusão de e-mails precisa da limpeza permanente
          para liberar seus conteúdos.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold">Importar e-mails de um arquivo</h2>
        <p className="text-sm text-muted-foreground">
          PST, OST, MBOX, EML, EMLX ou ZIP com EML/MBOX/EMLX. Até 20 GiB por arquivo e 50 MiB por
          mensagem. Apenas e-mails são importados; contatos e calendários não entram.
        </p>
        <Label htmlFor={'archive-file-' + mailboxId}>Arquivo de e-mail ou backup</Label>
        <Input
          ref={fileInput}
          id={'archive-file-' + mailboxId}
          type="file"
          accept=".pst,.ost,.mbox,.eml,.emlx,.zip"
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        {selectedFile && (
          <p className="break-all text-sm">
            {selectedFile.name} · {formatStorageBytes(String(selectedFile.size))}
          </p>
        )}
        {checking && (
          <p role="status" className="text-sm text-muted-foreground">
            Verificando espaço disponível na empresa e na caixa…
          </p>
        )}
        {admission && (
          <p className="text-sm text-muted-foreground">
            Disponível na empresa:{' '}
            {admission.tenant_remaining_bytes === null
              ? 'sem limite definido'
              : formatStorageBytes(admission.tenant_remaining_bytes)}
            . Nesta caixa:{' '}
            {admission.mailbox_remaining_bytes === null
              ? 'sem limite definido'
              : formatStorageBytes(admission.mailbox_remaining_bytes)}
            .
          </p>
        )}
        {admission?.warning && (
          <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
            Atenção: {admission.warning}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Você pode fechar este painel ou navegar pelo APMail durante o envio. Mantenha o APMail
          aberto até o arquivo ser recebido. Depois, análise e importação continuam na fila do
          servidor, mesmo com o navegador fechado.
        </p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Como funciona a importação e a retomada
          </summary>
          <p className="mt-2">
            Após o envio, o sistema analisa o arquivo e informa o tamanho real das mensagens
            extraídas, sem criar uma cópia descompactada no disco. Esse tamanho inclui duplicados e
            difere do consumo final: corpos, anexos e dados do sistema também são armazenados. Se a
            cota for atingida, a importação pausa e pode ser retomada. Histórico importado segue a
            janela de classificação definida no cadastro da caixa. Para retomar um envio
            interrompido, selecione novamente o mesmo arquivo; os blocos confirmados não serão
            enviados novamente.
          </p>
        </details>
        {(error || transfer?.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || transfer?.error}
          </p>
        )}
        {busy && (
          <div className="space-y-2">
            <progress
              value={transfer?.progress ?? progress}
              max={100}
              aria-label="Envio do arquivo"
              className="storage-quota-bar h-2 w-full"
            />
            <p role="status" className="text-sm">
              Enviando arquivo: {transfer?.progress ?? progress}%
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              !scope ||
              !selectedFile ||
              !selectedFingerprint ||
              (!admission && !transfer?.file) ||
              checking ||
              busy
            }
            onClick={() => void upload()}
          >
            <Upload aria-hidden />{' '}
            {busy
              ? 'Enviando…'
              : uploadTask || transfer?.file
                ? 'Continuar envio'
                : 'Importar arquivo'}
          </Button>
          {busy && (
            <Button variant="outline" onClick={() => scope && interruptArchiveTransfer(scope)}>
              Interromper envio
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold">Exportar backup</h2>
        <p className="text-sm text-muted-foreground">
          Baixe as mensagens e os anexos desta caixa. EML é entregue em ZIP organizado por pasta. A
          exportação não exclui mensagens.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor={'archive-format-' + mailboxId}>Formato do backup</Label>
            <select
              id={'archive-format-' + mailboxId}
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="h-11 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="mbox">MBOX</option>
              <option value="eml">EML (ZIP)</option>
              <option value="pst">PST — Outlook</option>
            </select>
          </div>
          {exportFormat === 'pst' ? (
            <Button
              disabled={creatingPst || generatingPst}
              onClick={async () => {
                if (creatingPst || generatingPst) return;
                setCreatingPst(true);
                try {
                  await api('/mailboxes/' + mailboxId + '/archive-exports', {
                    method: 'POST',
                    body: { format: 'pst' },
                  });
                  await client.invalidateQueries({ queryKey: ['pst-exports'] });
                  toast.success('Geração do PST na fila. Você pode fechar este painel.');
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : 'Não foi possível iniciar a geração do PST.',
                  );
                } finally {
                  setCreatingPst(false);
                }
              }}
            >
              {creatingPst ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {creatingPst ? 'Solicitando…' : generatingPst ? 'PST em andamento' : 'Gerar PST'}
            </Button>
          ) : (
            <Button asChild>
              <a href={'/api/mailboxes/' + mailboxId + '/archive-export?format=' + exportFormat}>
                <Download aria-hidden />
                Baixar backup
              </a>
            </Button>
          )}
        </div>
        {exportFormat === 'pst' && (
          <p className="text-sm text-muted-foreground">
            O PST preserva pastas, mensagens e anexos para abrir no Outlook. A geração continua no
            servidor ao fechar o painel. Usa espaço temporário na cota do APMail; o download fica
            disponível por 24 horas. Backups acima de aproximadamente 40 GiB são divididos em
            partes.
          </p>
        )}
        <PstExportJobs mailboxId={mailboxId} />
        <p className="text-xs text-muted-foreground">
          POP3, EML, EMLX e MBOX preservam o MIME importado. PST, OST e mensagens IMAP antigas são
          reconstruídos com os corpos e anexos disponíveis. Confira o download antes de excluir
          dados.
        </p>
        <ConfirmDialog
          trigger={
            <Button
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal text-left"
            >
              Liberar conteúdo de e-mails já excluídos
            </Button>
          }
          title="Remover permanentemente os conteúdos excluídos?"
          description="Confira seu backup antes de continuar. Corpos, arquivos MIME e anexos de mensagens POP3 ou importadas que já foram excluídas serão removidos. Identificadores mínimos permanecem para impedir novo download pelo POP3. Até 1.000 mensagens por operação; anexos em uso por rascunhos são preservados."
          onConfirm={async () => {
            const result = await api<{ purged: number; blocked: number; pending: number }>(
              '/mailboxes/' + mailboxId + '/archive-purge-deleted',
              { method: 'POST', body: { confirm: true } },
            );
            toast.success(
              `${result.purged} conteúdos removidos. ${result.blocked} preservados por uso em envios.${result.pending ? ' A limpeza de alguns arquivos será repetida automaticamente.' : ''}`,
            );
            await refresh();
          }}
        />
      </div>
      <ConfigurableTable<MailArchiveTask>
        listKey={'mail-archive-imports-' + mailboxId}
        mode="client"
        data={tasks.data ?? []}
        query={query}
        onQueryChange={setQuery}
        isLoading={tasks.isLoading}
        error={tasks.error}
        onRetry={() => void tasks.refetch()}
        columns={[
          { id: 'filename', header: 'Arquivo', hideable: false },
          {
            id: 'state',
            header: 'Situação',
            cell: (t) => (
              <span>
                <StatusBadge
                  label={
                    t.state === 'running' && !t.analyzed_at
                      ? 'Analisando arquivo'
                      : (states[t.state] ?? t.state)
                  }
                  variant={stateVariants[t.state] ?? 'neutral'}
                />
                {t.state === 'uploading' && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {formatStorageBytes(t.uploaded_bytes)} de {formatStorageBytes(t.size_bytes)}{' '}
                    recebidos
                  </span>
                )}
                {t.state === 'running' && !t.analyzed_at && (
                  <span className="mt-1 block text-xs text-muted-foreground" role="status">
                    {t.analyzed_messages ?? 0} mensagens analisadas ·{' '}
                    {formatStorageBytes(t.expanded_bytes ?? '0')} extraídos
                  </span>
                )}
                {t.analyzed_at && t.analyzed_messages > 0 && (
                  <span className="mt-2 block min-w-36 space-y-1">
                    <progress
                      className="storage-quota-bar h-2 w-full"
                      max={t.analyzed_messages}
                      value={t.cursor}
                      aria-label={'Processamento de ' + t.filename}
                    />
                    <span className="block text-xs text-muted-foreground">
                      {t.cursor} de {t.analyzed_messages} mensagens ·{' '}
                      {Math.floor((t.cursor * 100) / t.analyzed_messages)}%
                    </span>
                  </span>
                )}
                {t.last_error && (
                  <span
                    className={
                      'mt-1 block max-w-80 whitespace-normal ' +
                      (t.state === 'paused' ? 'text-warning-fg' : 'text-destructive')
                    }
                  >
                    {t.last_error}
                  </span>
                )}
                {['paused', 'failed'].includes(t.state) &&
                  Number(t.uploaded_bytes) === Number(t.size_bytes) && (
                    <span className="mt-2 block space-y-2">
                      <span className="block text-xs text-muted-foreground">
                        {t.cursor} mensagens processadas foram preservadas. Não é necessário enviar
                        o arquivo novamente.
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting !== null}
                        aria-label={'Retomar ' + t.filename}
                        onClick={() =>
                          void action(t.id, 'resume')
                            .then(() =>
                              toast.success(
                                'Importação na fila. O processamento continua do último registro confirmado.',
                              ),
                            )
                            .catch((e: unknown) =>
                              toast.error(
                                e instanceof Error ? e.message : 'Não foi possível retomar.',
                              ),
                            )
                        }
                      >
                        {acting === t.id ? (
                          <Loader2
                            className="animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                        ) : (
                          <Play aria-hidden />
                        )}
                        {acting === t.id ? 'Retomando…' : 'Retomar'}
                      </Button>
                    </span>
                  )}
              </span>
            ),
            value: (t) => states[t.state] ?? t.state,
          },
          {
            id: 'size_bytes',
            header: 'Arquivo original',
            align: 'right',
            cell: (t) => formatStorageBytes(t.size_bytes),
          },
          {
            id: 'expanded_bytes',
            header: 'Mensagens extraídas',
            align: 'right',
            cell: (t) =>
              t.analyzed_at
                ? formatStorageBytes(t.expanded_bytes)
                : t.state === 'running'
                  ? `${formatStorageBytes(t.expanded_bytes ?? '0')} (parcial)`
                  : 'Não analisado',
          },
          {
            id: 'added_storage_bytes',
            header: 'Adicionado ao APMail',
            align: 'right',
            cell: (t) => (
              <span title="Crescimento real confirmado nas transações das mensagens: MIME, corpos, anexos e metadados das mensagens/conversas. Não inclui a origem, cadastros de pastas ou auditoria. Total histórico, sem descontar exclusões posteriores; as barras mostram o consumo atual completo.">
                {formatStorageBytes(t.added_storage_bytes ?? '0')}
              </span>
            ),
          },
          { id: 'imported', header: 'Importados', align: 'right' },
          { id: 'skipped', header: 'Duplicados ignorados', align: 'right' },
          {
            id: 'created_at',
            header: 'Criado em',
            cell: (t) => new Date(t.created_at).toLocaleString('pt-BR'),
          },
        ]}
        rowActions={(t) => (
          <>
            {!['completed', 'cancelled'].includes(t.state) && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={acting !== null}
                    aria-label={'Cancelar ' + t.filename}
                  >
                    <X />
                  </Button>
                }
                title="Cancelar importação?"
                description="Mensagens já importadas permanecem. O arquivo de origem será removido para liberar seu espaço."
                onConfirm={() => action(t.id, 'cancel')}
              />
            )}
          </>
        )}
      />
      <p className="text-xs text-muted-foreground">
        Exibidas as 100 importações mais recentes desta caixa.
      </p>
    </section>
  );
}
