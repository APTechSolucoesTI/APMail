import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  mailRuleSchema,
  type MailRuleInput,
  type RuleCondition,
  type ListQuery,
} from '@apmail/shared';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Play, Ellipsis } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, useUserId, canMailbox, type Mailbox } from '@/lib/auth';
import type { MailRule, PersonalLabel } from '@/lib/organization';
import { folderLabel, type Folder } from '@/lib/mail';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
const fieldNames = {
  from: 'Remetente',
  to: 'Para',
  cc: 'Cc',
  any_recipient: 'Qualquer destinatário',
  subject: 'Assunto',
  body: 'Corpo',
  has_attachment: 'Possui anexo',
};
const operatorNames = {
  contains: 'contém',
  not_contains: 'não contém',
  equals: 'é igual a',
  starts_with: 'começa com',
  ends_with: 'termina com',
  is_true: 'sim',
  is_false: 'não',
};
const actionNames = {
  move_to_folder: 'Mover para pasta',
  mark_flagged: 'Sinalizar',
  assign_to: 'Atribuir a',
  exclude_from_queue: 'Excluir das filas',
  forward_to: 'Encaminhar para',
  add_label: 'Adicionar etiqueta',
  pin: 'Fixar',
};
const editorSchema = mailRuleSchema.safeExtend({ apply_existing: z.boolean().default(false) });
type EditorInput = z.input<typeof editorSchema>;
const selectClass = 'h-11 min-w-0 w-full rounded-md border border-input bg-card px-3 text-sm';
export function RuleManagement({
  mailboxId,
  fixedScope,
  query: externalQuery,
  onQueryChange,
}: {
  mailboxId?: string;
  fixedScope?: 'mailbox' | 'personal';
  query?: ListQuery;
  onQueryChange?: (q: ListQuery) => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    boxes = useQuery({
      queryKey: ['mailboxes', tenant],
      queryFn: () => api<Mailbox[]>('/mailboxes'),
    }),
    [scope, setScope] = useState<'mailbox' | 'personal'>(fixedScope ?? 'personal'),
    [draft, setDraft] = useState<MailRule | null>(null),
    [busy, setBusy] = useState(false),
    [localQuery, setLocalQuery] = useState<ListQuery>({ page: 1, pageSize: 10, filters: {} }),
    query = externalQuery ?? localQuery;
  const q = useQuery({
    queryKey: ['rules', tenant, scope, mailboxId],
    queryFn: () =>
      api<MailRule[]>('/rules?scope=' + scope + (mailboxId ? '&mailbox_id=' + mailboxId : '')),
  });
  const available = (boxes.data ?? [])
    .filter((b) => scope === 'personal' || canMailbox(b, 'rules'))
    .filter((b) => !mailboxId || b.id === mailboxId);
  const mutate = async (id: string, body: unknown) => {
    setBusy(true);
    try {
      await api('/rules/' + id, { method: 'PATCH', body });
      await client.invalidateQueries({ queryKey: ['rules'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    setDraft({
      id: '',
      mailbox_id: mailboxId ?? available[0]?.id ?? '',
      scope,
      name: '',
      is_active: true,
      priority: 100,
      match_mode: 'all',
      conditions: [{ field: 'from', operator: 'contains', value: '' }],
      actions: [{ type: scope === 'personal' ? 'pin' : 'mark_flagged' }],
      stop_processing: false,
      created_at: '',
    });
  const table = (
    <ConfigurableTable
      listKey={'rules-' + scope + (mailboxId ? '-' + mailboxId : '')}
      mode="client"
      data={q.data ?? []}
      query={query}
      onQueryChange={onQueryChange ?? setLocalQuery}
      isLoading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      toolbarLeft={
        <Button onClick={create} disabled={!available.length}>
          <Plus />
          Nova regra
        </Button>
      }
      columns={[
        { id: 'priority', header: 'Prioridade', align: 'right', sortable: true },
        {
          id: 'name',
          header: 'Nome',
          hideable: false,
          sortable: true,
          cell: (r) => (
            <span>
              {r.name}
              {r.review_reason && (
                <span className="block text-xs text-muted-foreground">{r.review_reason}</span>
              )}
            </span>
          ),
        },
        {
          id: 'mailbox_id',
          header: 'Caixa',
          value: (r) => boxes.data?.find((b) => b.id === r.mailbox_id)?.name ?? '',
        },
        {
          id: 'conditions',
          header: 'Condições',
          cell: (r) => (
            <span
              className="block max-w-80 truncate"
              title={r.conditions
                .map(
                  (c) =>
                    fieldNames[c.field] + ' ' + operatorNames[c.operator] + ' ' + (c.value ?? ''),
                )
                .join(r.match_mode === 'all' ? ' e ' : ' ou ')}
            >
              {r.conditions
                .map(
                  (c) =>
                    fieldNames[c.field] + ' ' + operatorNames[c.operator] + ' ' + (c.value ?? ''),
                )
                .join(r.match_mode === 'all' ? ' e ' : ' ou ')}
            </span>
          ),
        },
        {
          id: 'actions',
          header: 'Ações da regra',
          cell: (r) => r.actions.map((a) => actionNames[a.type]).join(', '),
        },
        {
          id: 'is_active',
          header: 'Ativa',
          cell: (r) => (
            <label className="inline-flex min-h-11 items-center gap-2">
              <Switch
                checked={r.is_active}
                disabled={busy}
                aria-label={'Ativar regra ' + r.name}
                onCheckedChange={(is_active) => void mutate(r.id, { is_active })}
              />
              <span>{r.is_active ? 'Sim' : 'Não'}</span>
            </label>
          ),
        },
      ]}
      rowActions={(r) => (
        <RuleRowActions
          rule={r}
          busy={busy}
          onEdit={() => setDraft(r)}
          onPriority={(priority) => mutate(r.id, { priority })}
          onApply={() => mutate(r.id, { apply_existing: true })}
          onDelete={async () => {
            await api('/rules/' + r.id, { method: 'DELETE' });
            await client.invalidateQueries({ queryKey: ['rules'] });
            toast.success('Regra excluída.');
          }}
        />
      )}
    />
  );
  return (
    <div className="space-y-4">
      {boxes.isLoading ? (
        <LoadingState />
      ) : boxes.error ? (
        <ErrorState onRetry={() => void boxes.refetch()} />
      ) : fixedScope ? (
        table
      ) : (
        <Tabs
          value={scope}
          onValueChange={(s) => {
            setScope(s as typeof scope);
            (onQueryChange ?? setLocalQuery)({ ...query, page: 1 });
          }}
        >
          <TabsList>
            <TabsTrigger value="personal">Minhas regras</TabsTrigger>
            {boxes.data?.some((b) => canMailbox(b, 'rules')) && (
              <TabsTrigger value="mailbox">Regras da caixa</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value={scope}>
            <p className="mb-4 text-sm text-muted-foreground">
              {scope === 'personal'
                ? 'Minhas regras aplicam etiquetas e fixações somente para você.'
                : 'Regras da caixa alteram a organização compartilhada. Somente administradores ou supervisores autorizados podem configurá-las.'}
            </p>
            {table}
          </TabsContent>
        </Tabs>
      )}
      <Sheet
        open={!!draft}
        onOpenChange={(v) => {
          if (!v) setDraft(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{draft?.id ? 'Editar regra' : 'Nova regra'}</SheetTitle>
            <SheetDescription>
              {scope === 'personal'
                ? 'Os efeitos serão aplicados apenas para você.'
                : 'Os efeitos serão aplicados na caixa compartilhada.'}
            </SheetDescription>
          </SheetHeader>
          {draft && (
            <RuleEditor
              key={draft.id || 'new-' + scope}
              rule={draft}
              boxes={available}
              onClose={() => setDraft(null)}
              onSaved={async () => {
                setDraft(null);
                await client.invalidateQueries({ queryKey: ['rules'] });
                toast.success('Regra salva.');
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
function RuleEditor({
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
    conditions = useFieldArray({ control: form.control, name: 'conditions' }),
    actions = useFieldArray({ control: form.control, name: 'actions' }),
    values = useWatch({ control: form.control }),
    [error, setError] = useState('');
  const [previewMessage, setPreviewMessage] = useState(''),
    [previewResult, setPreviewResult] = useState<{
      matches: boolean;
      conditions: boolean[];
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
      queryFn: () =>
        api<PersonalLabel[]>('/labels?mailbox_id=' + mailboxId).then((items) =>
          items.filter((l) => l.scope === (rule.scope === 'personal' ? 'personal' : 'tenant')),
        ),
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
  const allActions =
    rule.scope === 'personal'
      ? (['add_label', 'pin'] as const)
      : ([
          'add_label',
          'move_to_folder',
          'mark_flagged',
          'assign_to',
          'exclude_from_queue',
          'forward_to',
        ] as const);
  const defaultAction = (type: keyof typeof actionNames): MailRuleInput['actions'][number] => {
    switch (type) {
      case 'move_to_folder':
        return { type, folder_id: '' };
      case 'assign_to':
        return { type, user_id: '' };
      case 'forward_to':
        return { type, address: '' };
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
      className="space-y-4 p-4"
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
        </div>
      </div>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">Condições</legend>
        <p className="text-sm text-muted-foreground">
          Textos ignoram acentos, maiúsculas e espaços excedentes. E-mails são comparados por
          endereço. “É igual a” exige o valor completo.
        </p>
        <Label htmlFor="rule-mode">Quando corresponder a</Label>
        <select id="rule-mode" className={selectClass} {...form.register('match_mode')}>
          <option value="all">Todas as condições</option>
          <option value="any">Qualquer uma das condições</option>
        </select>
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="rule-preview-thread">Testar em uma conversa recente</Label>
          <select
            id="rule-preview-thread"
            className={selectClass}
            value={previewMessage}
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
            disabled={!previewMessage || previewBusy}
            onClick={async () => {
              setPreviewBusy(true);
              try {
                const detail = await api<{ messages: { id: string }[] }>(
                  '/threads/' + previewMessage,
                );
                const message = detail.messages.at(-1);
                if (!message) throw new Error('Esta conversa não tem mensagens disponíveis.');
                const result = await api<{ matches: boolean; conditions: boolean[] }>(
                  '/rules/preview',
                  {
                    method: 'POST',
                    body: { rule: mailRuleSchema.parse(form.getValues()), message_id: message.id },
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
              Condições:{' '}
              {previewResult.conditions
                .map((ok, i) => `${i + 1}: ${ok ? 'sim' : 'não'}`)
                .join(' · ')}
              . Nenhuma ação foi executada.
            </p>
          )}
        </div>
        {conditions.fields.map((item, i) => {
          const field = values.conditions?.[i]?.field ?? 'from',
            bool = field === 'has_attachment';
          return (
            <div key={item.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor={'condition-field-' + i}>Campo {i + 1}</Label>
                  <select
                    id={'condition-field-' + i}
                    className={selectClass}
                    value={field}
                    onChange={(e) => {
                      form.setValue(
                        `conditions.${i}.field`,
                        e.target.value as RuleCondition['field'],
                      );
                      form.setValue(
                        `conditions.${i}.operator`,
                        e.target.value === 'has_attachment' ? 'is_true' : 'contains',
                      );
                      form.setValue(`conditions.${i}.value`, '');
                    }}
                  >
                    {Object.entries(fieldNames).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={'condition-operator-' + i}>Operador {i + 1}</Label>
                  <select
                    id={'condition-operator-' + i}
                    className={selectClass}
                    {...form.register(`conditions.${i}.operator`)}
                  >
                    {Object.entries(operatorNames)
                      .filter(([key]) =>
                        bool
                          ? key === 'is_true' || key === 'is_false'
                          : key !== 'is_true' && key !== 'is_false',
                      )
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {!bool && (
                <div>
                  <Label htmlFor={'condition-value-' + i}>Valor {i + 1}</Label>
                  <Input id={'condition-value-' + i} {...form.register(`conditions.${i}.value`)} />
                </div>
              )}
              {fieldError('conditions.' + i)}
              {fieldError('conditions.' + i + '.value')}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={conditions.fields.length === 1}
                aria-label={'Remover condição ' + (i + 1)}
                onClick={() => conditions.remove(i)}
              >
                <Trash2 />
                Remover condição
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          disabled={conditions.fields.length >= 10}
          onClick={() => conditions.append({ field: 'subject', operator: 'contains', value: '' })}
        >
          <Plus />
          Adicionar condição
        </Button>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">Ações</legend>
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
                    disabled={value === 'forward_to' && !allowForward}
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
                  >
                    <option value="">Selecione uma etiqueta</option>
                    {labels.data?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} · {l.scope === 'tenant' ? 'Global' : 'Pessoal'}
                      </option>
                    ))}
                  </select>
                  {!labels.data?.length && (
                    <p className="text-xs text-muted-foreground">
                      Crie uma etiqueta nas configurações antes de usar esta ação.
                    </p>
                  )}
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
              {['folder_id', 'label_id', 'user_id', 'address'].map((key) => (
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
            Encaminhamento automático desativado. Um administrador precisa habilitar essa opção nas
            configurações da empresa.
          </p>
        )}
      </fieldset>
      {(['stop_processing', 'is_active', 'apply_existing'] as const).map((name, i) => (
        <label key={name} className="flex min-h-11 items-center gap-2">
          <Checkbox
            checked={!!values[name]}
            onCheckedChange={(v) => form.setValue(name, v === true)}
          />
          <span className="text-sm">
            {
              [
                'Parar de processar outras regras',
                'Regra ativa',
                'Aplicar também às mensagens dos últimos 30 dias',
              ][i]
            }
          </span>
        </label>
      ))}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
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

function RuleRowActions({
  rule,
  busy,
  onEdit,
  onPriority,
  onApply,
  onDelete,
}: {
  rule: MailRule;
  busy: boolean;
  onEdit: () => void;
  onPriority: (priority: number) => Promise<void>;
  onApply: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<'delete' | 'apply' | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={'Editar regra ' + rule.name}
        onClick={onEdit}
      >
        <Pencil />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={'Mais ações da regra ' + rule.name}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={rule.priority === 1}
            onSelect={() => void onPriority(Math.max(1, rule.priority - 1))}
          >
            <ArrowUp />
            Aumentar prioridade
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={rule.priority === 999}
            onSelect={() => void onPriority(Math.min(999, rule.priority + 1))}
          >
            <ArrowDown />
            Diminuir prioridade
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm('apply')}>
            <Play />
            Reaplicar aos últimos 30 dias
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('delete')}>
            <Trash2 />
            Excluir regra
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
        title={confirm === 'delete' ? 'Excluir regra?' : 'Reaplicar regra?'}
        destructive={confirm === 'delete'}
        description={
          confirm === 'delete'
            ? 'A regra ' + rule.name + ' deixará de ser aplicada.'
            : 'A regra será aplicada às mensagens dos últimos 30 dias.'
        }
        onConfirm={() => (confirm === 'delete' ? onDelete() : onApply())}
      />
    </>
  );
}
