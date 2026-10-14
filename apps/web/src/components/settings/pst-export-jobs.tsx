import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PstExportTask } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, useUserId } from '@/lib/auth';
import { formatStorageBytes } from '@/lib/storage-metering';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/common/status-badge';
const labels: Record<PstExportTask['state'], string> = {
  queued: 'Na fila',
  staging: 'Preparando mensagens',
  converting: 'Gerando PST',
  ready: 'Pronto para baixar',
  failed: 'Falha',
  cancelled: 'Cancelado',
  expired: 'Expirado',
};
export const pstExportQueryKey = (
  tenant: string | null,
  user: string | undefined,
  mailbox: string,
) => ['pst-exports', tenant, user, mailbox];
export function usePstExportJobs(mailboxId: string) {
  const tenant = useTenantId(),
    user = useUserId();
  return useQuery({
    queryKey: pstExportQueryKey(tenant, user, mailboxId),
    queryFn: () => api<PstExportTask[]>('/mailboxes/' + mailboxId + '/archive-exports'),
    refetchInterval: 5000,
  });
}
export function PstExportJobs({ mailboxId }: { mailboxId: string }) {
  const client = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);
  const jobs = usePstExportJobs(mailboxId);
  const action = async (id: string, kind: 'resume' | 'cancel') => {
    if (acting) return;
    setActing(id);
    try {
      await api('/mailboxes/' + mailboxId + '/archive-exports/' + id + '/' + kind, {
        method: 'POST',
      });
      await client.invalidateQueries({ queryKey: ['pst-exports'] });
      await client.invalidateQueries({ queryKey: ['storage-quota'] });
      if (kind === 'resume') toast.success('Geração do PST recolocada na fila.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Não foi possível atualizar a exportação.',
      );
    } finally {
      setActing(null);
    }
  };
  if (jobs.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível consultar os backups PST.{' '}
        <Button variant="ghost" size="sm" onClick={() => void jobs.refetch()}>
          Tentar novamente
        </Button>
      </p>
    );
  if (jobs.isLoading)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Consultando backups PST…
      </p>
    );
  if (!jobs.data?.length) return null;
  return (
    <section aria-label="Backups PST" className="space-y-3">
      <h3 className="text-sm font-semibold">Backups PST</h3>
      {jobs.data.map((task) => {
        const active = ['queued', 'staging', 'converting'].includes(task.state);
        const expired = new Date(task.expires_at).getTime() <= jobs.dataUpdatedAt && !active;
        const ready = task.state === 'ready' && !expired;
        const count = task.state === 'converting' || ready ? task.converted : task.prepared;
        return (
          <article key={task.id} className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-all text-sm font-semibold">{task.filename}</p>
              <StatusBadge
                label={expired ? 'Expirado' : labels[task.state]}
                variant={
                  ready
                    ? 'success'
                    : task.state === 'failed'
                      ? 'danger'
                      : active
                        ? 'info'
                        : 'neutral'
                }
              />
            </div>
            {active && (
              <div className="space-y-1">
                <progress
                  aria-label={'Geração de ' + task.filename}
                  value={count}
                  max={Math.max(1, task.total_messages)}
                  className="storage-quota-bar h-2 w-full"
                />
                <p role="status" className="text-xs text-muted-foreground">
                  {count} de {task.total_messages} mensagens ·{' '}
                  {task.state === 'queued'
                    ? 'Aguardando processamento'
                    : task.state === 'staging'
                      ? 'Preparando conteúdo'
                      : 'Gerando arquivo Outlook'}
                </p>
              </div>
            )}
            {task.last_error && (
              <p role="alert" className="text-sm text-destructive">
                {task.last_error}
              </p>
            )}
            {ready && (
              <>
                <p className="text-xs text-muted-foreground">
                  {task.converted} mensagens exportadas. Disponível até{' '}
                  {new Date(task.expires_at).toLocaleString('pt-BR')}.{' '}
                  {task.files.length > 1
                    ? 'O backup foi dividido em partes; baixe todos os arquivos PST.'
                    : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {task.files.map((file, index) => (
                    <Button key={file.id} asChild size="sm">
                      <a
                        aria-label={'Baixar ' + file.filename}
                        href={
                          '/api/mailboxes/' +
                          mailboxId +
                          '/archive-exports/' +
                          task.id +
                          '/files/' +
                          file.id
                        }
                      >
                        <Download aria-hidden />
                        Baixar {task.files.length > 1 ? 'parte ' + (index + 1) : 'PST'} ·{' '}
                        {formatStorageBytes(file.size_bytes)}
                      </a>
                    </Button>
                  ))}
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {task.state === 'failed' && !expired && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!acting}
                  onClick={() => void action(task.id, 'resume')}
                >
                  {acting === task.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
                  Tentar novamente
                </Button>
              )}
              {(active || ready || (task.state === 'failed' && !expired)) && (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" disabled={!!acting}>
                      {active ? 'Cancelar geração' : 'Descartar backup temporário'}
                    </Button>
                  }
                  title={active ? 'Cancelar a geração do PST?' : 'Descartar este backup PST?'}
                  description="Os arquivos temporários desta exportação serão removidos. Os e-mails e anexos da caixa continuam preservados."
                  onConfirm={() => action(task.id, 'cancel')}
                />
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
