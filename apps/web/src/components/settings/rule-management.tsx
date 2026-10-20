import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListQuery } from '@apmail/shared';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Play, Ellipsis } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, meQuery, canMailbox, type Mailbox } from '@/lib/auth';
import type { MailRule } from '@/lib/organization';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { RuleEditor } from './rule-editor';
import { fieldNames, operatorNames, actionNames, selectClass } from './rule-options';
export { RuleEditor } from './rule-editor';
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
  const timezone = useQuery(meQuery).data?.preferences.timezone ?? 'America/Sao_Paulo';
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
  const create = (vacation = false) =>
    setDraft({
      id: '',
      mailbox_id:
        mailboxId ??
        (vacation ? available.find((b) => canMailbox(b, 'send'))?.id : available[0]?.id) ??
        '',
      scope,
      name: vacation ? 'Resposta de férias' : '',
      is_active: true,
      priority: 100,
      match_mode: vacation ? 'always' : 'all',
      conditions: vacation ? [] : [{ field: 'from', operator: 'contains', value: '' }],
      exceptions: [],
      active_from: null,
      active_until: null,
      actions: vacation
        ? [
            {
              type: 'auto_reply',
              subject: 'Ausência temporária',
              message:
                'Olá!\n\nEstou de férias e retornarei em breve. Responderei à sua mensagem assim que voltar.\n\nObrigado pela compreensão.',
              cooldown_hours: 168,
            },
          ]
        : [{ type: scope === 'personal' ? 'pin' : 'mark_flagged' }],
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => create()} disabled={!available.length}>
            <Plus />
            Nova regra
          </Button>
          {scope === 'mailbox' && (
            <Button
              variant="outline"
              onClick={() => create(true)}
              disabled={!available.some((b) => canMailbox(b, 'send'))}
            >
              Resposta de férias
            </Button>
          )}
        </div>
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
              title={
                r.match_mode === 'always'
                  ? 'Todas as mensagens recebidas'
                  : r.conditions
                      .map(
                        (c) =>
                          fieldNames[c.field] +
                          ' ' +
                          operatorNames[c.operator] +
                          ' ' +
                          (c.value ?? ''),
                      )
                      .join(r.match_mode === 'all' ? ' e ' : ' ou ')
              }
            >
              {r.match_mode === 'always'
                ? 'Todas as mensagens recebidas'
                : r.conditions
                    .map(
                      (c) =>
                        fieldNames[c.field] +
                        ' ' +
                        operatorNames[c.operator] +
                        ' ' +
                        (c.value ?? ''),
                    )
                    .join(r.match_mode === 'all' ? ' e ' : ' ou ')}
              {!!r.exceptions?.length && (
                <span className="block text-xs text-muted-foreground">
                  {r.exceptions.length} exceção(ões)
                </span>
              )}
            </span>
          ),
        },
        {
          id: 'period',
          header: 'Período',
          cell: (r) => (
            <span className="text-xs" title={timezone}>
              {r.active_from
                ? new Date(r.active_from).toLocaleString('pt-BR', { timeZone: timezone })
                : 'Desde a ativação'}
              <br />
              {r.active_until
                ? 'Até ' + new Date(r.active_until).toLocaleString('pt-BR', { timeZone: timezone })
                : 'Sem término'}
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
              <span>
                {!r.is_active
                  ? 'Não'
                  : r.active_until && new Date(r.active_until) <= new Date()
                    ? 'Período encerrado'
                    : r.active_from && new Date(r.active_from) > new Date()
                      ? 'Agendada'
                      : 'Sim'}
              </span>
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
          onApply={(days) => mutate(r.id, { apply_existing: true, apply_since_days: days })}
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
                ? 'Etiquetas e fixações são pessoais. Movimentos e sinalizações alteram a caixa. Respostas automáticas são configuradas em Regras da caixa.'
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
        <SheetContent className="flex min-h-0 w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{draft?.id ? 'Editar regra' : 'Nova regra'}</SheetTitle>
            <SheetDescription>
              {scope === 'personal'
                ? 'Etiquetas e fixações são pessoais; mover e sinalizar alteram a caixa compartilhada.'
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
  onApply: (days: number | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<'delete' | 'apply' | null>(null);
  const [range, setRange] = useState('30');
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
          <DropdownMenuItem
            disabled={rule.actions.some((a) => a.type === 'auto_reply')}
            onSelect={() => setConfirm('apply')}
          >
            <Play />
            Aplicar às mensagens existentes…
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
            : 'Escolha quais mensagens devem receber as ações desta regra. Mensagens já organizadas também podem ser afetadas.'
        }
        onConfirm={() =>
          confirm === 'delete' ? onDelete() : onApply(range === 'all' ? null : Number(range))
        }
      >
        {confirm === 'apply' && (
          <div className="space-y-1">
            <Label htmlFor={'rule-range-' + rule.id}>Alcance da aplicação</Label>
            <select
              id={'rule-range-' + rule.id}
              className={selectClass}
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Último ano</option>
              <option value="all">Todas as mensagens, incluindo arquivos antigos</option>
            </select>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
