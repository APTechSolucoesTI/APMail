import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  mailRuleSchema,
  calendarInstant,
  calendarLocalInput,
  type MailRuleInput,
  type RuleCondition,
} from '@apmail/shared';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, useUserId, meQuery, canMailbox, type Mailbox } from '@/lib/auth';
import type { MailRule, PersonalLabel } from '@/lib/organization';
import { folderLabel, type Folder } from '@/lib/mail';
import { DateTimeField } from '@/components/calendar/date-time-field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { fieldNames, operatorNames, actionNames, selectClass } from './rule-options';
const editorSchema = mailRuleSchema.safeExtend({
  apply_existing: z.boolean().default(false),
  apply_since_days: z.number().int().min(1).max(365).nullable().default(30),
});
type EditorInput = z.input<typeof editorSchema>;
export function RuleEditor({
  rule,
  boxes,
  onClose,
  onSaved,
}: {
  rule: MailRule;
  boxes: Mailbox[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const tenant = useTenantId(),
    form = useForm<EditorInput>({
      resolver: zodResolver(editorSchema),
      defaultValues: { ...rule, id: rule.id || undefined, apply_existing: false },
    }),
    actions = useFieldArray({ control: form.control, name: 'actions' }),
    values = useWatch({ control: form.control }),
    [error, setError] = useState('');
  const timezone = useQuery(meQuery).data?.preferences.timezone ?? 'America/Sao_Paulo';
  const autoReply = values.actions?.some((a) => a.type === 'auto_reply');
  const [previewMessage, setPreviewMessage] = useState(''),
    [previewResult, setPreviewResult] = useState<{
      matches: boolean;
      conditions: boolean[];
      exceptions?: boolean[];
    } | null>(null),
    [previewBusy, setPreviewBusy] = useState(false);
  const mailboxId = values.mailbox_id ?? '',
    folders = useQuery({
      queryKey: ['folders', tenant, mailboxId],
      queryFn: () => api<Folder[]>('/mailboxes/' + mailboxId + '/folders'),
      enabled: !!mailboxId,
    }),
    labels = useQuery({
      queryKey: ['labels', tenant, useUserId(), mailboxId],
      queryFn: () => api<PersonalLabel[]>('/labels?mailbox_id=' + mailboxId),
      select: (items) =>
        items.filter((l) => l.scope === (rule.scope === 'personal' ? 'personal' : 'tenant')),
      enabled: !!mailboxId,
    }),
    users = useQuery({
      queryKey: ['assignable', tenant, mailboxId],
      queryFn: () =>
        api<{ id: string; full_name: string }[]>('/mailboxes/' + mailboxId + '/assignable'),
      enabled: !!mailboxId && rule.scope === 'mailbox',
    }),
    company = useQuery({
      queryKey: ['tenant', tenant],
      queryFn: () => api<{ settings: { allow_external_auto_forward?: boolean } }>('/tenant'),
    }),
    allowForward = !!company.data?.settings.allow_external_auto_forward;
  const previewMessages = useQuery({
    queryKey: ['rule-preview-messages', tenant, mailboxId],
    queryFn: () =>
      api<{ items: { id: string; subject: string }[] }>(
        '/mailboxes/' + mailboxId + '/threads?page_size=10&view=search',
      ),
    enabled: !!mailboxId,
  });
  const selectedPreview = previewMessages.data?.items.some((item) => item.id === previewMessage)
    ? previewMessage
    : '';
  const allActions =
    rule.scope === 'personal'
      ? ([
          'add_label',
          'pin',
          ...(boxes.some((box) => box.id === mailboxId && canMailbox(box, 'organize'))
            ? (['move_to_folder', 'mark_flagged'] as const)
            : []),
        ] as const)
      : ([
          'add_label',
          'pin',
          'move_to_folder',
          'mark_flagged',
          'assign_to',
          'exclude_from_queue',
          'forward_to',
          'auto_reply',
        ] as const);
  const defaultAction = (type: keyof typeof actionNames): MailRuleInput['actions'][number] => {
    switch (type) {
      case 'move_to_folder':
        return { type, folder_id: '' };
      case 'assign_to':
        return { type, user_id: '' };
      case 'forward_to':
        return { type, address: '' };
      case 'auto_reply':
        form.setValue('apply_existing', false);
        return {
          type,
          subject: '',
          message: 'Olá!\n\nRecebemos sua mensagem. Retornaremos assim que possível.',
          cooldown_hours: 168,
        };
      case 'add_label':
        return { type, label_id: labels.data?.[0]?.id ?? '' };
      default:
        return { type };
    }
  };
  const fieldError = (path: string) => {
    const e = form.getFieldState(path as keyof EditorInput, form.formState).error;
    return e?.message ? (
      <p role="alert" className="text-xs text-destructive">
        {e.message}
      </p>
    ) : null;
  };
  const folderOptions = (items: Folder[], prefix = ''): React.ReactNode[] =>
    items.flatMap((f) => [
      <option key={f.id} value={f.id}>
        {prefix + folderLabel(f)}
      </option>,
      ...folderOptions(f.children, prefix + folderLabel(f) + ' / '),
    ]);
  return (
    <form
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      noValidate
      onSubmit={form.handleSubmit(async (body) => {
        setError('');
        try {
          await api('/rules' + (rule.id ? '/' + rule.id : ''), {
            method: rule.id ? 'PATCH' : 'POST',
            body,
          });
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <Label htmlFor="rule-name">Nome da regra</Label>
          <Input
            id="rule-name"
            {...form.register('name')}
            aria-invalid={!!form.formState.errors.name}
          />
          {fieldError('name')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rule-box">Caixa</Label>
            <select
              id="rule-box"
              className={selectClass}
              {...form.register('mailbox_id')}
              disabled={!!rule.id}
            >
              <option value="">Selecione uma caixa</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {fieldError('mailbox_id')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-priority">Prioridade</Label>
            <Input
              id="rule-priority"
              type="number"
              min={1}
              max={999}
              {...form.register('priority', { valueAsNumber: true })}
            />
            {fieldError('priority')}
            <p className="text-xs text-muted-foreground">
              Números menores são executados primeiro.
            </p>
          </div>
        </div>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Condições</legend>
          <p className="text-sm text-muted-foreground">
            {values.match_mode === 'always'
              ? 'Qualquer remetente pode corresponder à regra, respeitando as exceções abaixo.'
              : 'Textos ignoram acentos, maiúsculas e espaços excedentes. E-mails são comparados por endereço. “É igual a” exige o valor completo.'}
          </p>
          <Label htmlFor="rule-mode">Quando corresponder a</Label>
          <select
            id="rule-mode"
            className={selectClass}
            {...form.register('match_mode', {
              onChange: (e) => {
                if (e.target.value === 'always') form.setValue('conditions', []);
                if (e.target.value !== 'always' && !form.getValues('conditions').length)
                  form.setValue('conditions', [{ field: 'from', operator: 'contains', value: '' }]);
              },
            })}
          >
            <option value="always">Todas as mensagens recebidas</option>
            <option value="all">Todas as condições</option>
            <option value="any">Qualquer uma das condições</option>
          </select>
          <details className="space-y-2 rounded-md border p-3">
            <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Testar regra sem executar ações
            </summary>
            <div className="mt-3 space-y-2">
              <Label htmlFor="rule-preview-thread">Testar em uma conversa recente</Label>
              <select
                id="rule-preview-thread"
                className={selectClass}
                value={selectedPreview}
                onChange={(e) => {
                  setPreviewMessage(e.target.value);
                  setPreviewResult(null);
                }}
              >
                <option value="">Selecione uma conversa</option>
                {previewMessages.data?.items.map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.subject || '(Sem assunto)'}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={!selectedPreview || previewBusy}
                onClick={async () => {
                  setPreviewBusy(true);
                  try {
                    const result = await api<{ matches: boolean; conditions: boolean[] }>(
                      '/rules/preview',
                      {
                        method: 'POST',
                        body: {
                          rule: mailRuleSchema.parse(form.getValues()),
                          thread_id: selectedPreview,
                        },
                      },
                    );
                    setPreviewResult(result);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Não foi possível testar.');
                  } finally {
                    setPreviewBusy(false);
                  }
                }}
              >
                {previewBusy ? 'Testando…' : 'Testar condições'}
              </Button>
              {previewResult && (
                <p role="status" className="text-sm">
                  {previewResult.matches
                    ? 'A mensagem corresponde à regra.'
                    : 'A mensagem não corresponde à regra.'}{' '}
                  {previewResult.conditions.length ? 'Condições: ' : 'Abrange todas as mensagens. '}
                  {previewResult.conditions
                    .map((ok, i) => `${i + 1}: ${ok ? 'sim' : 'não'}`)
                    .join(' · ')}
                  {previewResult.exceptions?.length
                    ? ' Exceções: ' +
                      previewResult.exceptions
                        .map((ok, i) => `${i + 1}: ${ok ? 'corresponde' : 'não corresponde'}`)
                        .join(' · ') +
                      '. '
                    : ' '}
                  Nenhuma ação foi executada.
                </p>
              )}
            </div>
          </details>
          {values.match_mode !== 'always' && <RuleConditionRows form={form} name="conditions" />}
          {fieldError('conditions')}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Exceções</legend>
          <p className="text-sm text-muted-foreground">
            Não aplicar se qualquer uma destas condições corresponder. Por exemplo, ignore um
            remetente ou assunto específico.
          </p>
          <RuleConditionRows form={form} name="exceptions" />
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Ações</legend>
          {fieldError('actions')}
          {actions.fields.map((item, i) => {
            const action = values.actions?.[i],
              type = action?.type ?? 'pin';
            return (
              <div key={item.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
                <Label htmlFor={'rule-action-' + i}>Ação {i + 1}</Label>
                <select
                  id={'rule-action-' + i}
                  className={selectClass}
                  value={type}
                  onChange={(e) =>
                    actions.update(i, defaultAction(e.target.value as keyof typeof actionNames))
                  }
                >
                  {allActions.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        (value === 'forward_to' && !allowForward) ||
                        (value === 'auto_reply' &&
                          !boxes.some((b) => b.id === mailboxId && canMailbox(b, 'send')))
                      }
                    >
                      {actionNames[value]}
                    </option>
                  ))}
                </select>
                {type === 'move_to_folder' && (
                  <div>
                    <Label htmlFor={'action-target-' + i}>Pasta de destino</Label>
                    <select
                      id={'action-target-' + i}
                      className={selectClass}
                      {...form.register(`actions.${i}.folder_id`)}
                      value={
                        values.actions?.[i]?.type === 'move_to_folder'
                          ? (values.actions[i].folder_id ?? '')
                          : ''
                      }
                    >
                      <option value="">Selecione uma pasta</option>
                      {folderOptions(folders.data ?? [])}
                    </select>
                    {folders.error && (
                      <p role="alert" className="text-sm text-destructive">
                        Não foi possível carregar as pastas.
                      </p>
                    )}
                  </div>
                )}
                {type === 'assign_to' && (
                  <div>
                    <Label htmlFor={'action-target-' + i}>Responsável</Label>
                    <select
                      id={'action-target-' + i}
                      className={selectClass}
                      {...form.register(`actions.${i}.user_id`)}
                      value={
                        values.actions?.[i]?.type === 'assign_to'
                          ? (values.actions[i].user_id ?? '')
                          : ''
                      }
                    >
                      <option value="">Selecione um usuário</option>
                      {users.data?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {type === 'add_label' && (
                  <div>
                    <Label htmlFor={'action-target-' + i}>Etiqueta</Label>
                    <select
                      id={'action-target-' + i}
                      className={selectClass}
                      {...form.register(`actions.${i}.label_id`)}
                      value={
                        values.actions?.[i]?.type === 'add_label'
                          ? (values.actions[i].label_id ?? '')
                          : ''
                      }
                    >
                      <option value="">Selecione uma etiqueta</option>
                      {labels.data?.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} · {l.scope === 'tenant' ? 'Global' : 'Pessoal'}
                        </option>
                      ))}
                    </select>
                    {labels.isLoading && (
                      <p role="status" className="text-xs text-muted-foreground">
                        Carregando etiquetas…
                      </p>
                    )}
                    {labels.error && (
                      <p role="alert" className="text-sm text-destructive">
                        Não foi possível carregar as etiquetas.{' '}
                        <Button type="button" variant="ghost" onClick={() => void labels.refetch()}>
                          Tentar novamente
                        </Button>
                      </p>
                    )}
                    {!labels.isLoading && !labels.error && !labels.data?.length && (
                      <p className="text-xs text-muted-foreground">
                        Crie uma etiqueta nas configurações antes de usar esta ação.
                      </p>
                    )}
                  </div>
                )}
                {type === 'auto_reply' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor={'auto-subject-' + i}>Assunto da resposta</Label>
                      <Input
                        id={'auto-subject-' + i}
                        maxLength={200}
                        placeholder="Em branco: Resposta automática + assunto original"
                        {...form.register(`actions.${i}.subject`)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={'auto-message-' + i}>Mensagem da resposta automática</Label>
                      <Textarea
                        id={'auto-message-' + i}
                        rows={7}
                        maxLength={10000}
                        {...form.register(`actions.${i}.message`)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={'auto-cooldown-' + i}>
                        Responder novamente ao mesmo remetente após
                      </Label>
                      <select
                        id={'auto-cooldown-' + i}
                        className={selectClass}
                        {...form.register(`actions.${i}.cooldown_hours`, { valueAsNumber: true })}
                      >
                        <option value={1}>1 hora</option>
                        <option value={24}>1 dia</option>
                        <option value={72}>3 dias</option>
                        <option value={168}>7 dias (recomendado)</option>
                        <option value={720}>30 dias</option>
                      </select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Somente novas mensagens recebidas. Não responde a listas, spam, notificações
                      automáticas, endereços da própria caixa ou mensagens importadas. O intervalo
                      vale para todas as respostas automáticas desta caixa.
                    </p>
                  </div>
                )}
                {type === 'forward_to' && (
                  <div>
                    <Label htmlFor={'action-target-' + i}>Endereço de destino</Label>
                    <Input
                      id={'action-target-' + i}
                      type="email"
                      {...form.register(`actions.${i}.address`)}
                    />
                  </div>
                )}
                {fieldError('actions.' + i)}
                {[
                  'folder_id',
                  'label_id',
                  'user_id',
                  'address',
                  'subject',
                  'message',
                  'cooldown_hours',
                ].map((key) => (
                  <div key={key}>{fieldError('actions.' + i + '.' + key)}</div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={actions.fields.length === 1}
                  aria-label={'Remover ação ' + (i + 1)}
                  onClick={() => actions.remove(i)}
                >
                  <Trash2 />
                  Remover ação
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            disabled={actions.fields.length >= 5}
            onClick={() =>
              actions.append({ type: rule.scope === 'personal' ? 'pin' : 'mark_flagged' })
            }
          >
            <Plus />
            Adicionar ação
          </Button>
          {rule.scope === 'mailbox' && !allowForward && (
            <p className="text-xs text-muted-foreground">
              Encaminhamento automático desativado. Um administrador precisa habilitar essa opção
              nas configurações da empresa.
            </p>
          )}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Período de ativação</legend>
          <p className="text-xs text-muted-foreground">
            Opcional · Fuso horário: {timezone}. Sem datas, a regra segue o controle Regra ativa.
          </p>
          {(['active_from', 'active_until'] as const).map((key, index) => (
            <div key={key} className="space-y-1">
              <DateTimeField
                label={index === 0 ? 'Início' : 'Término'}
                value={values[key] ? calendarLocalInput(values[key], timezone) : ''}
                onChange={(local) => form.setValue(key, calendarInstant(local, timezone))}
              />
              {values[key] && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => form.setValue(key, null)}
                >
                  Limpar {index === 0 ? 'início' : 'término'}
                </Button>
              )}
              {fieldError(key)}
            </div>
          ))}
        </fieldset>
        {(['stop_processing', 'is_active', 'apply_existing'] as const)
          .filter((name) => !autoReply || name !== 'apply_existing')
          .map((name) => (
            <label key={name} className="flex min-h-11 items-center gap-2">
              <Checkbox
                checked={!!values[name]}
                onCheckedChange={(v) => form.setValue(name, v === true)}
              />
              <span className="text-sm">
                {
                  {
                    stop_processing: 'Parar de processar outras regras',
                    is_active: 'Regra ativa',
                    apply_existing: 'Aplicar também às mensagens existentes',
                  }[name]
                }
              </span>
            </label>
          ))}
        {values.apply_existing && (
          <div className="space-y-1">
            <Label htmlFor="rule-existing-range">Alcance da aplicação</Label>
            <select
              id="rule-existing-range"
              className={selectClass}
              value={
                values.apply_since_days === null ? 'all' : String(values.apply_since_days ?? 30)
              }
              onChange={(event) =>
                form.setValue(
                  'apply_since_days',
                  event.target.value === 'all' ? null : Number(event.target.value),
                )
              }
            >
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Último ano</option>
              <option value="all">Todas as mensagens, incluindo arquivos antigos</option>
            </select>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t bg-card p-4">
        <Button disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando…' : 'Salvar regra'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={form.formState.isSubmitting}
          onClick={onClose}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function RuleConditionRows({
  form,
  name,
}: {
  form: UseFormReturn<EditorInput>;
  name: 'conditions' | 'exceptions';
}) {
  const fields = useFieldArray({ control: form.control, name });
  const values = useWatch({ control: form.control, name });
  const exception = name === 'exceptions';
  return (
    <div className="space-y-3">
      {fields.fields.map((item, i) => {
        const field = values?.[i]?.field ?? 'from',
          bool = field === 'has_attachment';
        const error = form.getFieldState(`${name}.${i}`, form.formState).error;
        return (
          <div key={item.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={name + '-field-' + i}>
                  {exception ? 'Campo da exceção' : 'Campo'} {i + 1}
                </Label>
                <select
                  id={name + '-field-' + i}
                  className={selectClass}
                  value={field}
                  onChange={(e) => {
                    form.setValue(`${name}.${i}`, {
                      field: e.target.value as RuleCondition['field'],
                      operator: e.target.value === 'has_attachment' ? 'is_true' : 'contains',
                      value: '',
                    });
                  }}
                >
                  {Object.entries(fieldNames).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={name + '-operator-' + i}>Operador {i + 1}</Label>
                <select
                  id={name + '-operator-' + i}
                  className={selectClass}
                  {...form.register(`${name}.${i}.operator`)}
                >
                  {Object.entries(operatorNames)
                    .filter(([v]) =>
                      bool
                        ? ['is_true', 'is_false'].includes(v)
                        : !['is_true', 'is_false'].includes(v),
                    )
                    .map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            {!bool && (
              <div className="space-y-1">
                <Label htmlFor={name + '-value-' + i}>Valor {i + 1}</Label>
                <Input id={name + '-value-' + i} {...form.register(`${name}.${i}.value`)} />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error.message ?? 'Confira o operador e o valor desta condição.'}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!exception && fields.fields.length === 1}
              onClick={() => fields.remove(i)}
            >
              <Trash2 />
              {exception ? 'Remover exceção' : 'Remover condição'}
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={fields.fields.length >= 10}
        onClick={() => fields.append({ field: 'from', operator: 'contains', value: '' })}
      >
        <Plus />
        {exception ? 'Adicionar exceção' : 'Adicionar condição'}
      </Button>
    </div>
  );
}
