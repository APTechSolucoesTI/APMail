import { useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MailOpen,
  Mail,
  UserCheck,
  UserRoundPlus,
  ListChecks,
  RotateCcw,
  CheckCircle2,
  FolderInput,
  Trash2,
  Flag,
  ShieldAlert,
  Pin,
  Tags,
  Ellipsis,
  CircleSlash,
  Inbox,
  ListTodo,
  Printer,
} from 'lucide-react';
import { normalizeRuleEmail, type MailboxPerm } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  canMailbox,
  meQuery,
  useAccess,
  useMailQueues,
  useTenantId,
  type Mailbox,
} from '@/lib/auth';
import {
  flattenFolders,
  folderLabel,
  threadDetailKey,
  type Folder,
  type Thread,
  type ThreadDetail,
} from '@/lib/mail';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { MailActionButton } from './mail-action-button';
import { ThreadLabels } from './thread-labels';
import { ConversationPdf } from './conversation-pdf';
import { ShareToChatDialog } from '@/components/chat/share-to-chat-dialog';
import { ThreadTasks } from './thread-tasks';

type Group = { box: Mailbox; threads: Thread[] };
type Assignee = { id: string; full_name: string };
type SpamTarget = { box: Mailbox; threadIds: string[]; messageIds: string[]; senders: string[] };

/** Uses the existing mailbox endpoints; folders and permissions never cross mailbox boundaries. */
export function MailSelectionActions({
  threads,
  onProcessed,
}: {
  threads: Thread[];
  onProcessed: (ids: string[]) => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery),
    queues = useMailQueues();
  const boxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const groups: Group[] = (boxes.data ?? [])
    .map((box) => ({ box, threads: threads.filter((t) => t.mailbox_id === box.id) }))
    .filter((g) => g.threads.length);
  const complete =
    groups.reduce((count, g) => count + g.threads.length, 0) === threads.length &&
    threads.length > 0;
  const allowed = (permission: MailboxPerm) =>
    complete && groups.every((g) => canMailbox(g.box, permission));
  const mayMove = useAccess('mail.move') && allowed('organize') && allowed('move');
  const mayDelete = useAccess('mail.delete') && allowed('organize') && allowed('delete');
  const mayFlag = useAccess('mail.flag') && allowed('organize') && allowed('flag');
  const mayRestore = useAccess('mail.restore') && allowed('organize') && allowed('restore');
  const maySpam = useAccess('rules') && mayMove && allowed('rules');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [dialog, setDialog] = useState<
    'move' | 'delete' | 'assign' | 'labels' | 'tasks' | 'print' | null
  >(null);
  const [destinations, setDestinations] = useState<Record<string, string>>({}),
    [userId, setUserId] = useState('');
  const [spam, setSpam] = useState<SpamTarget[] | null>(null);
  const [activeId, setActiveId] = useState('');
  const activeThread = threads.find((t) => t.id === activeId) ?? threads[0];
  const folders = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['folders', tenant, g.box.id],
      queryFn: () => api<Folder[]>('/mailboxes/' + g.box.id + '/folders'),
      enabled: dialog === 'move',
    })),
  });
  const assignees = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['assignable', tenant, g.box.id],
      queryFn: () => api<Assignee[]>('/mailboxes/' + g.box.id + '/assignable'),
      enabled: dialog === 'assign' && allowed('assign_others'),
    })),
  });
  const eligibleUsers = (assignees[0]?.data ?? []).filter((user) =>
    assignees.every((q) => q.data?.some((u) => u.id === user.id)),
  );
  const invalidate = async () => {
    await Promise.all(
      ['threads', 'thread', 'folders', 'queue-counts', 'thread-history', 'rules'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  };
  const run = async (operation: (g: Group) => Promise<unknown>) => {
    if (busy || !complete) return;
    setBusy(true);
    setError('');
    const processed: string[] = [];
    try {
      for (const group of groups) {
        await operation(group);
        processed.push(...group.threads.map((t) => t.id));
      }
      setDialog(null);
      setSpam(null);
      onProcessed(processed);
      toast.success('Conversas atualizadas.');
    } catch (cause) {
      const message =
        (processed.length ? `${processed.length} conversa(s) já foram atualizadas. ` : '') +
        (cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.');
      setError(message);
      toast.error(message);
      if (processed.length) onProcessed(processed);
    } finally {
      setBusy(false);
      await invalidate();
    }
  };
  const bulk = (action: string, extra: Record<string, unknown> = {}) =>
    run((g) =>
      api('/mailboxes/' + g.box.id + '/threads/bulk', {
        method: 'POST',
        body: { thread_ids: g.threads.map((t) => t.id), action, ...extra },
      }),
    );
  const messages = (type: string, extra: Record<string, unknown> = {}) =>
    run((g) =>
      api('/mailboxes/' + g.box.id + '/messages/actions', {
        method: 'POST',
        body: { thread_ids: g.threads.map((t) => t.id), type, ...extra },
      }),
    );
  const each = (action: string, body?: Record<string, unknown>, method = 'POST') =>
    run(async (g) => {
      for (const thread of g.threads)
        await api('/threads/' + thread.id + '/' + action, { method, ...(body ? { body } : {}) });
    });
  const prepareSpam = async () => {
    setBusy(true);
    setError('');
    try {
      const targets = await Promise.all(
        groups.map(async (group) => {
          const tree = await client.fetchQuery({
            queryKey: ['folders', tenant, group.box.id],
            queryFn: () => api<Folder[]>('/mailboxes/' + group.box.id + '/folders'),
          });
          const excluded = new Set(
            flattenFolders(tree)
              .filter((f) => ['junk', 'trash'].includes(f.special_use ?? ''))
              .map((f) => f.id),
          );
          const details = await Promise.all(
            group.threads.map((t) =>
              client.fetchQuery({
                queryKey: threadDetailKey(tenant, t.id),
                queryFn: () => api<ThreadDetail>('/threads/' + t.id),
              }),
            ),
          );
          const chosen = details.flatMap((detail) => {
            const sender = [...detail.messages]
              .reverse()
              .find((m) => m.direction === 'inbound' && !m.is_mdn)?.from_address;
            return detail.messages.filter(
              (m) =>
                sender &&
                m.direction === 'inbound' &&
                !m.is_mdn &&
                !m.pending_action &&
                !excluded.has(m.folder_id ?? '') &&
                normalizeRuleEmail(m.from_address) === normalizeRuleEmail(sender),
            );
          });
          if (!chosen.length)
            throw new Error(
              'Selecione conversas com mensagens recebidas disponíveis para marcar como spam.',
            );
          return {
            box: group.box,
            threadIds: group.threads.map((t) => t.id),
            messageIds: [...new Set(chosen.map((m) => m.id))],
            senders: [...new Set(chosen.map((m) => m.from_address))],
          };
        }),
      );
      setSpam(targets);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const single = threads.length === 1 ? threads[0] : undefined;
  return (
    <div
      className="space-y-2 border-b bg-muted/50 p-3"
      aria-label="Ações das conversas selecionadas"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 w-full text-xs sm:w-auto">
          {threads.length} selecionada(s) nesta página
        </span>
        <MailActionButton
          label="Marcar lida"
          disabled={busy || !complete}
          onClick={() => void bulk('read')}
        >
          <MailOpen />
        </MailActionButton>
        <MailActionButton
          label="Marcar como não lida"
          disabled={busy || !complete}
          onClick={() => void bulk('unread')}
        >
          <Mail />
        </MailActionButton>
        {queues && allowed('assign_self') && (
          <MailActionButton
            label="Assumir"
            disabled={busy}
            onClick={() => void bulk('assign', { user_id: me.data?.user.id })}
          >
            <UserCheck />
          </MailActionButton>
        )}
        {queues && allowed('assign_others') && (
          <MailActionButton
            label="Atribuir responsável"
            text="Atribuir"
            disabled={busy}
            onClick={() => setDialog('assign')}
          >
            <UserRoundPlus />
          </MailActionButton>
        )}
        {queues && allowed('queue') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MailActionButton label="Status" disabled={busy}>
                <ListChecks />
              </MailActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={threads.some((t) => (t.pending_task_count ?? 0) > 0)}
                onSelect={() => void bulk('done')}
              >
                <CheckCircle2 />
                Marcar como concluída
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void bulk('reopen')}>
                <RotateCcw />
                Reabrir conversa
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void each('queue-excluded', { excluded: true }, 'PUT')}
              >
                <CircleSlash />
                Excluir das filas
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void each('queue-excluded', { excluded: false }, 'PUT')}
              >
                <Inbox />
                Incluir nas filas
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {threads[0] && (
          <ShareToChatDialog
            key={threads.map((t) => t.id).join(',')}
            threadId={threads[0].id}
            threadIds={threads.map((t) => t.id)}
            iconOnly
          />
        )}
        {(mayMove || mayDelete || mayFlag || mayRestore) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MailActionButton label="Organizar" disabled={busy}>
                <FolderInput />
              </MailActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {mayMove && (
                <DropdownMenuItem onSelect={() => setDialog('move')}>
                  <FolderInput />
                  Mover para pasta
                </DropdownMenuItem>
              )}
              {mayFlag && (
                <>
                  <DropdownMenuItem onSelect={() => void messages('set_flag', { flagged: true })}>
                    <Flag />
                    Sinalizar
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void messages('set_flag', { flagged: false })}>
                    <Flag />
                    Remover sinalização
                  </DropdownMenuItem>
                </>
              )}
              {mayRestore && (
                <DropdownMenuItem onSelect={() => void messages('restore')}>
                  <RotateCcw />
                  Restaurar da Lixeira
                </DropdownMenuItem>
              )}
              {mayDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
                    <Trash2 />
                    Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MailActionButton label="Mais ações" disabled={busy || !complete}>
              <Ellipsis />
            </MailActionButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setDialog('labels')}>
              <Tags />
              Etiquetas
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void each('pin')}>
              <Pin />
              Alternar fixação pessoal
            </DropdownMenuItem>
            {allowed('rules') && (
              <DropdownMenuItem onSelect={() => void each('pin', { scope: 'mailbox' })}>
                <Pin />
                Alternar fixação para a caixa
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setDialog('tasks')}>
              <ListTodo />
              Tarefas dos e-mails
            </DropdownMenuItem>
            {maySpam && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void prepareSpam()}>
                  <ShieldAlert />
                  Marcar como spam
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {single ? (
          <ConversationPdf threadId={single.id} subject={single.subject} />
        ) : (
          <MailActionButton
            label="Imprimir conversas"
            disabled={busy}
            onClick={() => setDialog('print')}
          >
            <Printer />
          </MailActionButton>
        )}
      </div>
      {threads.some((t) => (t.pending_task_count ?? 0) > 0) && (
        <p className="text-xs text-muted-foreground">
          Conclua ou dispense as tarefas pendentes antes de finalizar as conversas.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        pending={busy}
        destructive
        title="Excluir mensagens?"
        description={`${threads.length} conversa(s) serão movidas para a Lixeira nas caixas de origem. Mensagens já na Lixeira serão excluídas definitivamente.`}
        onConfirm={() =>
          run(async (g) => {
            await api('/mailboxes/' + g.box.id + '/messages/actions', {
              method: 'POST',
              body: { thread_ids: g.threads.map((t) => t.id), type: 'delete' },
            });
          })
        }
      />
      <ConfirmDialog
        open={!!spam}
        onOpenChange={(open) => !open && setSpam(null)}
        pending={busy}
        title="Marcar como spam?"
        description={`As mensagens recebidas de ${spam?.flatMap((t) => t.senders).join(', ') ?? ''} serão movidas para Spam nas respectivas caixas. Os próximos e-mails desses remetentes também irão para Spam nessas caixas. Você poderá desativar os filtros em Configurações > Regras.`}
        onConfirm={() =>
          run((g) => {
            const target = spam!.find((t) => t.box.id === g.box.id)!;
            return api('/mailboxes/' + g.box.id + '/messages/actions', {
              method: 'POST',
              body: { type: 'spam', message_ids: target.messageIds },
            });
          })
        }
      />
      <Dialog
        open={!!dialog && dialog !== 'delete'}
        onOpenChange={(open) => !open && !busy && setDialog(null)}
      >
        <DialogContent className="max-h-[90dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {dialog === 'move'
                ? 'Mover mensagens'
                : dialog === 'assign'
                  ? 'Atribuir responsável'
                  : dialog === 'tasks'
                    ? 'Tarefas dos e-mails'
                    : dialog === 'print'
                      ? 'Imprimir conversas'
                      : 'Etiquetas das conversas'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'move'
                ? 'Escolha o destino em cada caixa de origem.'
                : dialog === 'assign'
                  ? 'Somente pessoas disponíveis em todas as caixas selecionadas são exibidas.'
                  : 'As alterações respeitam a conversa e a caixa de origem.'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'move' &&
            groups.map((g, i) => (
              <label key={g.box.id} className="space-y-1 text-sm">
                {g.box.name} · {g.box.email_address}
                <select
                  className="block h-11 w-full rounded-md border bg-card px-2"
                  value={destinations[g.box.id] ?? ''}
                  onChange={(e) => setDestinations({ ...destinations, [g.box.id]: e.target.value })}
                >
                  <option value="">Selecione uma pasta</option>
                  {flattenFolders(folders[i]?.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {folderLabel(f)}
                    </option>
                  ))}
                </select>
                {folders[i]?.isError && (
                  <span role="alert">Não foi possível carregar as pastas.</span>
                )}
              </label>
            ))}
          {dialog === 'assign' && (
            <label className="space-y-1 text-sm">
              Responsável
              <select
                className="block h-11 w-full rounded-md border bg-card px-2"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">Sem responsável</option>
                {eligibleUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              {assignees.some((q) => q.isPending) && (
                <span role="status">Carregando responsáveis…</span>
              )}
              {assignees.some((q) => q.isError) && (
                <span role="alert">Não foi possível carregar os responsáveis.</span>
              )}
            </label>
          )}
          {dialog === 'labels' &&
            groups.map((g) => (
              <div
                key={g.box.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span className="min-w-0 break-all text-sm">
                  {g.box.email_address} · {g.threads.length} conversa(s)
                </span>
                <ThreadLabels mailboxId={g.box.id} threadIds={g.threads.map((t) => t.id)} />
              </div>
            ))}
          {(dialog === 'tasks' || dialog === 'print') && activeThread && (
            <>
              <label htmlFor="selected-mail-action" className="space-y-1 text-sm">
                Conversa
                <select
                  id="selected-mail-action"
                  className="block h-11 w-full rounded-md border bg-card px-2"
                  value={activeThread.id}
                  onChange={(e) => setActiveId(e.target.value)}
                >
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.mailbox_email} · {t.subject}
                    </option>
                  ))}
                </select>
              </label>
              {dialog === 'tasks' ? (
                <ThreadTasks
                  key={activeThread.id}
                  threadId={activeThread.id}
                  mailboxId={activeThread.mailbox_id!}
                  subject={activeThread.subject}
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Imprimir a conversa completa selecionada</span>
                  <ConversationPdf threadId={activeThread.id} subject={activeThread.subject} />
                </div>
              )}
            </>
          )}
          {(dialog === 'move' || dialog === 'assign') && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button
                disabled={
                  busy ||
                  (dialog === 'move'
                    ? groups.some((g, i) => !destinations[g.box.id] || folders[i]?.isError)
                    : assignees.some((q) => q.isPending || q.isError))
                }
                onClick={() =>
                  void (dialog === 'move'
                    ? run((g) =>
                        api('/mailboxes/' + g.box.id + '/messages/actions', {
                          method: 'POST',
                          body: {
                            thread_ids: g.threads.map((t) => t.id),
                            type: 'move',
                            target_folder_id: destinations[g.box.id],
                          },
                        }),
                      )
                    : bulk('assign', { user_id: userId || null }))
                }
              >
                {busy ? 'Aplicando…' : 'Aplicar'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
