import { useRef, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  listQuerySchema,
  MAIL_ARCHIVE_MAX_BYTES,
  mailArchiveFormat,
  type MailArchiveTask,
} from '@apmail/shared';
import { api, ApiError } from '@/lib/api';
import { useTenantId, useUserId } from '@/lib/auth';
import { formatStorageBytes } from '@/lib/storage-metering';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge, type StatusVariant } from '@/components/common/status-badge';
type Admission = {
  near_limit: boolean;
  tenant_remaining_bytes: string | null;
  mailbox_remaining_bytes: string | null;
  warning: string | null;
};
const states: Record<string, string> = {
  uploading: 'Aguardando arquivo',
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
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [exportFormat, setExportFormat] = useState('mbox'),
    [query, setQuery] = useState(() => listQuerySchema.parse({}));
  const request = useRef<XMLHttpRequest | null>(null),
    selection = useRef(0),
    fileInput = useRef<HTMLInputElement | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  const tasks = useQuery({
    queryKey: ['mail-archives', tenant, user, mailboxId],
    queryFn: () => api<MailArchiveTask[]>('/mailboxes/' + mailboxId + '/archive-imports'),
    refetchInterval: 5000,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['mail-archives', tenant, user, mailboxId] });
    await client.invalidateQueries({ queryKey: ['storage-quota'] });
  };
  const choose = async (value: File | null) => {
    const version = ++selection.current;
    setFile(value);
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
      const result = await api<Admission>(
        '/mailboxes/' + mailboxId + '/archive-imports/preflight',
        { method: 'POST', body: { filename: value.name, size_bytes: value.size } },
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
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);
    setError('');
    try {
      const info = await api<Admission>('/mailboxes/' + mailboxId + '/archive-imports/preflight', {
        method: 'POST',
        body: { filename: file.name, size_bytes: file.size },
      });
      setAdmission(info);
      const task = await api<MailArchiveTask>('/mailboxes/' + mailboxId + '/archive-imports', {
        method: 'POST',
        body: { filename: file.name, size_bytes: file.size },
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        request.current = xhr;
        xhr.open('POST', '/api/mailboxes/' + mailboxId + '/archive-imports/' + task.id + '/upload');
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let message = 'Não foi possível receber o arquivo.';
            try {
              message = JSON.parse(xhr.responseText).error?.message ?? message;
            } catch {
              /* Empty proxy error. */
            }
            reject(new ApiError(xhr.status, 'archive_upload', message));
          }
        };
        xhr.onerror = () =>
          reject(new Error('A conexão foi interrompida. Refaça o envio do arquivo.'));
        xhr.onabort = () => reject(new Error('Envio cancelado.'));
        xhr.send(file);
      });
      toast.success('Arquivo recebido. Acompanhe a importação abaixo.');
      setFile(null);
      setAdmission(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível importar.');
    } finally {
      request.current = null;
      setBusy(false);
      await refresh();
    }
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
        {file && (
          <p className="break-all text-sm">
            {file.name} · {formatStorageBytes(String(file.size))}
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
        <p className="text-xs text-muted-foreground">
          O arquivo de origem ocupa espaço até a conclusão. A descompactação, os corpos e anexos
          podem exigir capacidade adicional. Se a cota for atingida, a importação pausa e pode ser
          retomada. Histórico importado segue a janela de classificação definida no cadastro da
          caixa.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {busy && (
          <div className="space-y-2">
            <progress
              value={progress}
              max={100}
              aria-label="Envio do arquivo"
              className="storage-quota-bar h-2 w-full"
            />
            <p role="status" className="text-sm">
              Enviando arquivo: {progress}%
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!file || !admission || checking || busy} onClick={() => void upload()}>
            <Upload aria-hidden /> {busy ? 'Enviando…' : 'Importar arquivo'}
          </Button>
          {busy && (
            <Button variant="outline" onClick={() => request.current?.abort()}>
              Cancelar envio
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
            </select>
          </div>
          <Button asChild>
            <a href={'/api/mailboxes/' + mailboxId + '/archive-export?format=' + exportFormat}>
              <Download aria-hidden />
              Baixar backup
            </a>
          </Button>
        </div>
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
                  label={states[t.state] ?? t.state}
                  variant={stateVariants[t.state] ?? 'neutral'}
                />
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
              </span>
            ),
            value: (t) => states[t.state] ?? t.state,
          },
          {
            id: 'size_bytes',
            header: 'Tamanho',
            align: 'right',
            cell: (t) => formatStorageBytes(t.size_bytes),
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
            {['paused', 'failed'].includes(t.state) && (
              <Button
                variant="ghost"
                size="icon"
                disabled={acting !== null}
                aria-label={'Retomar ' + t.filename}
                onClick={() => void action(t.id, 'resume').catch((e) => toast.error(e.message))}
              >
                <Play />
              </Button>
            )}
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
