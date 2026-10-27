import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListQuery } from '@apmail/shared';
import { Plus, Pencil, ShieldOff, ShieldCheck, Play, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import type { SenderTrustRule } from '@/lib/antivirus';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/common/status-badge';
import { MailActionButton } from '@/components/mail/mail-action-button';
import { EmptyState } from '@/components/data/data-state';

export function SenderTrustSettings({
  query,
  onQueryChange,
}: {
  query: ListQuery;
  onQueryChange: (value: ListQuery) => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient();
  const [editing, setEditing] = useState<SenderTrustRule | null | undefined>(undefined);
  const [action, setAction] = useState<{ rule: SenderTrustRule; kind: 'toggle' | 'apply' } | null>(
    null,
  );
  const params = new URLSearchParams({
    page: String(query.page),
    page_size: String(query.pageSize),
    search: query.search ?? '',
  });
  const rules = useQuery({
    queryKey: ['antivirus-rules', tenant, params.toString()],
    refetchInterval: 15000,
    queryFn: ({ signal }) =>
      api<{ items: SenderTrustRule[]; total: number }>('/security/antivirus/rules?' + params, {
        signal,
      }),
  });
  const refresh = async () => {
    await client.invalidateQueries({
      predicate: (q) =>
        [
          'antivirus-rules',
          'antivirus-files',
          'antivirus-overview',
          'attachment-security',
          'thread',
        ].includes(String(q.queryKey[0])),
    });
  };
  return (
    <>
      <section className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="max-w-3xl">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <MailCheck className="size-5 text-primary" />
            Confiança com controle
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Gerencie quais remetentes podem ter anexos liberados automaticamente. Cada regra usa um
            endereço exato e pode valer para uma caixa ou para toda a empresa.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            O ClamAV continua analisando os arquivos. A regra libera apenas bloqueios preventivos
            selecionados; ameaças e falhas continuam bloqueadas. O endereço do remetente pode ser
            falsificado: cadastre apenas origens conhecidas.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus className="size-4" />
          Adicionar remetente
        </Button>
      </section>
      <ConfigurableTable<SenderTrustRule>
        listKey="antivirus-trust-v1"
        mode="server"
        query={query}
        onQueryChange={onQueryChange}
        data={rules.data?.items ?? []}
        total={rules.data?.total ?? 0}
        isLoading={rules.isLoading}
        error={rules.error}
        onRetry={() => void rules.refetch()}
        searchPlaceholder="Buscar remetente confiável…"
        columns={[
          {
            id: 'sender',
            header: 'Remetente',
            sortable: false,
            cell: (rule) => (
              <div className="max-w-72">
                <p className="truncate font-medium" title={rule.sender}>
                  {rule.sender}
                </p>
                {rule.notes && (
                  <p className="mt-1 truncate text-muted-foreground" title={rule.notes}>
                    {rule.notes}
                  </p>
                )}
              </div>
            ),
          },
          {
            id: 'scope',
            header: 'Abrangência',
            sortable: false,
            cell: (rule) => (
              <span title={rule.mailbox_email ?? 'Todas as caixas da empresa'}>
                {rule.mailbox_name ?? 'Todas as caixas da empresa'}
              </span>
            ),
          },
          {
            id: 'policy',
            header: 'Liberação automática',
            sortable: false,
            cell: (rule) =>
              rule.policy === 'encrypted' ? 'Arquivos com senha' : 'Senha e limites de análise',
          },
          {
            id: 'status',
            header: 'Estado',
            sortable: false,
            cell: (rule) => (
              <StatusBadge
                label={
                  !rule.enabled
                    ? 'Desativada'
                    : rule.expires_at && +new Date(rule.expires_at) <= rules.dataUpdatedAt
                      ? 'Expirada'
                      : 'Ativa'
                }
                variant={
                  !rule.enabled
                    ? 'neutral'
                    : rule.expires_at && +new Date(rule.expires_at) <= rules.dataUpdatedAt
                      ? 'warning'
                      : 'success'
                }
              />
            ),
          },
          {
            id: 'expires',
            header: 'Validade',
            sortable: false,
            cell: (rule) =>
              rule.expires_at ? new Date(rule.expires_at).toLocaleDateString('pt-BR') : 'Sem prazo',
          },
          {
            id: 'creator',
            header: 'Criado por',
            sortable: false,
            defaultVisible: false,
            cell: (rule) => rule.creator_name ?? 'Administrador',
          },
        ]}
        rowActions={(rule) => (
          <div className="flex">
            <MailActionButton label={'Editar ' + rule.sender} onClick={() => setEditing(rule)}>
              <Pencil />
            </MailActionButton>
            <MailActionButton
              label={(rule.enabled ? 'Desativar ' : 'Ativar ') + rule.sender}
              onClick={() => setAction({ rule, kind: 'toggle' })}
            >
              {rule.enabled ? <ShieldOff /> : <ShieldCheck />}
            </MailActionButton>
            <MailActionButton
              label={'Aplicar regra aos anexos existentes de ' + rule.sender}
              disabled={
                !rule.enabled ||
                (!!rule.expires_at && +new Date(rule.expires_at) <= rules.dataUpdatedAt)
              }
              onClick={() => setAction({ rule, kind: 'apply' })}
            >
              <Play />
            </MailActionButton>
          </div>
        )}
        emptyState={
          <EmptyState
            icon={MailCheck}
            title="Nenhum remetente confiável"
            description="Adicione uma origem conhecida para liberar automaticamente os bloqueios preventivos escolhidos."
          />
        }
      />
      {editing !== undefined && (
        <SenderTrustEditor rule={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />
      )}
      <ConfirmDialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={
          action?.kind === 'apply'
            ? 'Aplicar aos anexos já recebidos?'
            : action?.rule.enabled
              ? 'Desativar confiança neste remetente?'
              : 'Ativar confiança neste remetente?'
        }
        description={
          action?.kind === 'apply'
            ? 'Serão processados até 100 anexos bloqueados compatíveis com esta regra. Se houver mais, repita a ação. Arquivos com ameaças detectadas não serão liberados.'
            : 'A alteração revoga as liberações anteriores feitas por esta regra. Liberações manuais continuam válidas. Ao ativar, a regra vale para as próximas análises; use Aplicar para arquivos já recebidos.'
        }
        onConfirm={async () => {
          if (!action) return;
          if (action.kind === 'apply') {
            const result = await api<{ released: number }>(
              '/security/antivirus/rules/' + action.rule.id + '/apply',
              { method: 'POST', body: {} },
            );
            toast.success(`${result.released} anexo(s) liberado(s) pela regra.`);
          } else {
            await api('/security/antivirus/rules/' + action.rule.id, {
              method: 'PATCH',
              body: { ...action.rule, enabled: !action.rule.enabled },
            });
            toast.success('Regra atualizada.');
          }
          await refresh();
          setAction(null);
        }}
      />
    </>
  );
}
function SenderTrustEditor({
  rule,
  onClose,
  onSaved,
}: {
  rule: SenderTrustRule | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const tenant = useTenantId();
  const boxes = useQuery({
    queryKey: ['antivirus-mailboxes', tenant],
    queryFn: () => api<{ id: string; name: string; email_address: string }[]>('/mailboxes'),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{
    sender: string;
    mailbox_id: string;
    policy: 'encrypted' | 'preventive';
    notes: string;
    enabled: boolean;
    expires: string;
  }>({
    defaultValues: {
      sender: rule?.sender ?? '',
      mailbox_id: rule?.mailbox_id ?? '',
      policy: rule?.policy ?? 'encrypted',
      notes: rule?.notes ?? '',
      enabled: rule?.enabled ?? true,
      expires: rule?.expires_at ? new Date(rule.expires_at).toLocaleDateString('en-CA') : '',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: {
      sender: string;
      mailbox_id: string;
      policy: 'encrypted' | 'preventive';
      notes: string;
      enabled: boolean;
      expires: string;
    }) =>
      api('/security/antivirus/rules' + (rule ? '/' + rule.id : ''), {
        method: rule ? 'PATCH' : 'POST',
        body: {
          ...values,
          sender: values.sender.trim().toLowerCase(),
          mailbox_id: values.mailbox_id || null,
          expires_at: values.expires ? new Date(values.expires + 'T23:59:59').toISOString() : null,
        },
      }),
    onSuccess: async () => {
      await onSaved();
      toast.success('Regra de confiança salva.');
      onClose();
    },
  });
  const selectClass =
    'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? 'Editar remetente confiável' : 'Adicionar remetente confiável'}
          </DialogTitle>
          <DialogDescription>
            Defina exatamente quais bloqueios preventivos esta origem pode liberar.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <div className="space-y-2">
            <Label htmlFor="trust-sender">E-mail do remetente</Label>
            <Input
              id="trust-sender"
              type="email"
              maxLength={254}
              autoComplete="off"
              placeholder="remetente@empresa.com.br"
              {...register('sender', { required: 'Informe o e-mail exato do remetente.' })}
            />
            {errors.sender && (
              <p role="alert" className="text-xs text-destructive">
                {errors.sender.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="trust-mailbox">Aplicar na caixa</Label>
            <select
              id="trust-mailbox"
              className={selectClass}
              disabled={boxes.isPending || boxes.isError}
              {...register('mailbox_id')}
            >
              <option value="">Todas as caixas da empresa</option>
              {boxes.data?.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name} · {box.email_address}
                </option>
              ))}
            </select>
            {boxes.isError && (
              <p role="alert" className="text-xs text-destructive">
                Não foi possível consultar as caixas.{' '}
                <button type="button" className="underline" onClick={() => void boxes.refetch()}>
                  Tentar novamente
                </button>
              </p>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Permitir automaticamente</legend>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="radio"
                value="encrypted"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                {...register('policy')}
              />
              <span>
                Somente arquivos protegidos por senha
                <span className="mt-1 block text-xs text-muted-foreground">
                  Libera anexos criptografados enviados por esta origem.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="radio"
                value="preventive"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                {...register('policy')}
              />
              <span>
                Senha e limites de análise
                <span className="mt-1 block text-xs text-muted-foreground">
                  Inclui alertas preventivos do ClamAV por limites de inspeção.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="trust-expiry">Válida até (opcional)</Label>
            <Input id="trust-expiry" type="date" {...register('expires')} />
            <p className="text-xs text-muted-foreground">
              Sem data, a regra permanece válida até ser desativada.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="trust-notes">Observações</Label>
            <Textarea id="trust-notes" rows={2} maxLength={2000} {...register('notes')} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" {...register('enabled')} />
            Regra ativa
          </label>
          {rule && (
            <p className="rounded-md border border-warning/30 bg-warning-bg p-3 text-xs text-warning-fg">
              Salvar a edição revoga as liberações anteriores desta regra. Após salvar, use Aplicar
              para reavaliar os anexos já recebidos.
            </p>
          )}
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending ? 'Salvando…' : 'Salvar regra'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
