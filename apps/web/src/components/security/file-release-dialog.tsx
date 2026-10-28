import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { antivirusFindingKind } from '@apmail/shared';
import { FileCheck2, ShieldAlert, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, useAccess } from '@/lib/auth';
import type { ReleaseTarget } from '@/lib/antivirus';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingState, ErrorState } from '@/components/data/data-state';
type ReleaseValues = {
  reason: string;
  false_positive: boolean;
  acknowledge_risk: boolean;
  acknowledge_malware: boolean;
  trust: boolean;
};

export function FileReleaseDialog({
  targets,
  revoke = false,
  onClose,
}: {
  targets: ReleaseTarget[];
  revoke?: boolean;
  onClose: () => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    id = useId();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReleaseValues>({
    defaultValues: {
      reason: revoke ? 'Revogação da liberação por decisão do responsável.' : '',
      false_positive: false,
      acknowledge_risk: false,
      acknowledge_malware: false,
      trust: false,
    },
  });
  const malware = targets.some((t) => antivirusFindingKind(t) === 'malware');
  const mayTrust = useAccess('antivirus.trust');
  const sender = targets[0]?.sender,
    mailbox = targets[0]?.mailbox_id;
  const canTrust =
    !revoke &&
    mayTrust &&
    !!sender &&
    targets.every(
      (t) => t.sender === sender && t.mailbox_id === mailbox && t.kind === 'attachment',
    );
  const mutation = useMutation({
    mutationFn: (values: ReleaseValues) =>
      api<{ released?: number; revoked?: number }>(
        '/security/antivirus/releases' + (revoke ? '/revoke' : ''),
        {
          method: 'POST',
          body: {
            file_ids: targets.map((t) => t.id),
            ...values,
            ...(!revoke && canTrust && values.trust
              ? {
                  trust_sender: {
                    sender,
                    mailbox_id: mailbox,
                    notes: values.reason,
                  },
                }
              : {}),
          },
        },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (q) =>
          [
            'antivirus-overview',
            'antivirus-files',
            'antivirus-rules',
            'antivirus-decisions',
            'attachment-security',
            'antivirus-release-context',
            'thread',
          ].includes(String(q.queryKey[0])) && q.queryKey[1] === tenant,
      });
      toast.success(
        revoke
          ? 'Liberação revogada. Os anexos voltaram a ser bloqueados.'
          : `${targets.length} anexo(s) liberado(s).`,
      );
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            {revoke ? (
              <ShieldOff className="size-5 text-warning-fg" />
            ) : (
              <FileCheck2 className="size-5 text-primary" />
            )}
            {revoke ? 'Revogar liberação' : 'Liberar anexos'}
          </DialogTitle>
          <DialogDescription>
            {revoke
              ? 'O acesso será bloqueado imediatamente. O histórico das decisões será preservado.'
              : 'Permita visualizar e baixar os arquivos selecionados. Esta decisão não altera o resultado da análise do ClamAV.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
        >
          <ul
            className="max-h-28 space-y-1 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm"
            aria-label="Arquivos selecionados"
          >
            {targets.map((t) => (
              <li key={t.id} className="min-w-0">
                <p className="truncate font-medium" title={t.filename}>
                  {t.filename}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {t.threat_name ?? (t.status === 'error' ? 'Verificação não concluída' : t.status)}
                </p>
              </li>
            ))}
          </ul>
          {!revoke && (
            <p
              className={
                'flex items-start gap-2 rounded-md border p-3 text-xs ' +
                (malware
                  ? 'border-danger/30 bg-danger-bg text-danger-fg'
                  : 'border-warning/30 bg-warning-bg text-warning-fg')
              }
            >
              <ShieldAlert className="size-4 shrink-0" />
              {malware
                ? 'Há uma ameaça detectada nesta seleção. Libere somente após uma análise independente de segurança.'
                : 'O arquivo foi bloqueado pelo antivírus. Confira sua origem antes de autorizar o acesso.'}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={id + '-reason'}>Motivo da {revoke ? 'revogação' : 'liberação'}</Label>
            <Textarea
              id={id + '-reason'}
              rows={3}
              maxLength={2000}
              aria-invalid={!!errors.reason}
              {...register('reason', {
                required: 'Informe o motivo.',
                minLength: { value: 8, message: 'Descreva o motivo com pelo menos 8 caracteres.' },
              })}
            />
            {errors.reason && (
              <p role="alert" className="text-xs text-destructive">
                {errors.reason.message}
              </p>
            )}
          </div>
          {!revoke && (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  {...register('false_positive')}
                />
                <span>
                  Marcar como possível falso positivo
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Registra sua avaliação nesta empresa; nenhum arquivo é enviado a terceiros.
                  </span>
                </span>
              </label>
              {canTrust && (
                <label className="flex items-start gap-2 rounded-md border bg-secondary/40 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    {...register('trust')}
                  />
                  <span className="min-w-0">
                    Adicionar aos remetentes confiáveis
                    <span className="mt-1 block break-all text-xs text-muted-foreground">
                      {sender} · somente nesta caixa. Os anexos deste remetente serão liberados
                      automaticamente. Configure validade e escopo em Remetentes confiáveis.
                    </span>
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  {...register('acknowledge_risk', {
                    validate: (value) => value || 'Confirme a decisão de liberação.',
                  })}
                />
                <span>Confio na origem e assumo a decisão de liberar estes arquivos.</span>
              </label>
              {malware && (
                <label className="flex items-start gap-2 text-sm text-danger-fg">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    {...register('acknowledge_malware', {
                      validate: (value) => value || 'Confirme que está ciente da ameaça detectada.',
                    })}
                  />
                  <span>
                    Estou ciente de que o ClamAV detectou uma ameaça e autorizo a liberação mesmo
                    assim.
                  </span>
                </label>
              )}
              {(errors.acknowledge_risk || errors.acknowledge_malware) && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.acknowledge_risk?.message ?? errors.acknowledge_malware?.message}
                </p>
              )}
            </div>
          )}
          {mutation.error && (
            <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger-fg">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              className="h-11 sm:h-8"
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button className="h-11 sm:h-8" type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Salvando…'
                : revoke
                  ? 'Revogar liberação'
                  : `Liberar ${targets.length === 1 ? 'anexo' : targets.length + ' anexos'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function AttachmentReleaseDialog({
  fileId,
  revoke,
  onClose,
}: {
  fileId: string;
  revoke: boolean;
  onClose: () => void;
}) {
  const tenant = useTenantId();
  const context = useQuery({
    queryKey: ['antivirus-release-context', tenant, fileId],
    queryFn: ({ signal }) =>
      api<ReleaseTarget>('/security/antivirus/files/' + fileId + '/release-context', { signal }),
    staleTime: 0,
  });
  if (context.data)
    return <FileReleaseDialog targets={[context.data]} revoke={revoke} onClose={onClose} />;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Segurança do anexo</DialogTitle>
          <DialogDescription>Consultando o estado atual do arquivo.</DialogDescription>
        </DialogHeader>
        {context.isError ? <ErrorState onRetry={() => void context.refetch()} /> : <LoadingState />}
      </DialogContent>
    </Dialog>
  );
}
