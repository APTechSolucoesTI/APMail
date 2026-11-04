import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ContextMenu as Menu } from 'radix-ui';
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clipboard,
  Copy,
  Eye,
  Flag,
  FolderInput,
  Forward,
  Inbox,
  ListChecks,
  ListTodo,
  Mail,
  MailOpen,
  MessageSquare,
  Pin,
  Printer,
  Reply,
  ReplyAll,
  RotateCcw,
  ShieldAlert,
  Tags,
  Trash2,
  UserRoundPlus,
  UserCheck,
  Workflow,
} from 'lucide-react';
import { normalizeRuleEmail, resolveAddress } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  canMailbox,
  useAccess,
  useMailQueues,
  useTenantId,
  useUserId,
  type Mailbox,
} from '@/lib/auth';
import {
  flattenFolders,
  threadDetailKey,
  type Folder,
  type Thread,
  type ThreadDetail,
} from '@/lib/mail';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ContactAssociationDialog } from '@/components/contacts/contact-association-dialog';
import { ContactEditorDialog } from '@/components/contacts/contact-form';
import { ShareToChatDialog } from '@/components/chat/share-to-chat-dialog';
import { ConversationPdf } from './conversation-pdf';
import { MessageActions } from './message-actions';
import { RuleFromEmailDialog } from './rule-from-email-dialog';
import { SpamConfirmation } from './spam-confirmation';
import { ThreadAssignee } from './thread-assignee';
import { ThreadLabels } from './thread-labels';
import { ThreadNotes } from './thread-notes';
import { ThreadTasks } from './thread-tasks';

const menuClass =
  'z-50 w-60 max-w-[var(--radix-context-menu-content-available-width)] max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0';
const itemClass =
  'flex min-h-11 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[disabled]:opacity-50 lg:min-h-8 [&_svg]:size-4 [&_svg]:shrink-0';

function Item({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(itemClass, className)} {...props} />;
}

function Group({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className={itemClass}>
        {icon}
        {label}
        <ChevronRight className="ml-auto" />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent className={menuClass} collisionPadding={8}>
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

type ActionDialog =
  | 'move'
  | 'delete'
  | 'share'
  | 'print'
  | 'labels'
  | 'rule'
  | 'tasks'
  | 'notes'
  | 'assign'
  | 'spam'
  | 'contact';

export function MailContextMenu({
  thread,
  mailboxId,
  folderId,
  onOpen,
  onCompose,
  children,
}: {
  thread: Thread;
  mailboxId: string;
  folderId?: string;
  onOpen: () => void;
  onCompose: (mode: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const client = useQueryClient();
  const tenant = useTenantId();
  const userId = useUserId();
  const queues = useMailQueues();
  const rules = useAccess('rules');
  const contacts = useAccess('contacts');
  const createContact = useAccess('contacts.create');
  const editContact = useAccess('contacts.edit');
  const move = useAccess('mail.move');
  const remove = useAccess('mail.delete');
  const restore = useAccess('mail.restore');
  const flag = useAccess('mail.flag');
  const messageId = thread.message_id ?? undefined;
  const active = open || !!dialog;
  const box = useQuery({
    queryKey: ['mailbox', tenant, mailboxId],
    queryFn: () => api<Mailbox>('/mailboxes/' + mailboxId),
    enabled: active,
  });
  const folders = useQuery({
    queryKey: ['folders', tenant, mailboxId],
    queryFn: () => api<Folder[]>('/mailboxes/' + mailboxId + '/folders'),
    enabled: active,
  });
  const threadPath = '/threads/' + thread.id;
  const detail = useQuery({
    queryKey: threadDetailKey(tenant, thread.id, messageId, folderId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (messageId) params.set('message_id', messageId);
      if (folderId) params.set('folder_id', folderId);
      return api<ThreadDetail>(threadPath + '?' + params);
    },
    enabled: active,
  });
  const messages = detail.data?.messages ?? [];
  const message = messages.at(-1);
  const current = detail.data?.thread ?? thread;
  const allowed = (permission: Parameters<typeof canMailbox>[1]) =>
    !!box.data && canMailbox(box.data, permission);
  const organize = allowed('organize');
  const mayMove = organize && move && allowed('move');
  const mayRules = rules && allowed('rules');
  const canQueue = queues && allowed('queue');
  const canAssign = queues && allowed('assign_others');
  const canAssume =
    queues && !!userId && allowed('assign_self') && current.assigned_to?.id !== userId;
  const flatFolders = flattenFolders(folders.data ?? []);
  const specialUse = (id: string | null) =>
    flatFolders.find((folder) => folder.id === id)?.special_use;
  const archive = flatFolders.find((folder) => folder.special_use === 'archive');
  const inTrash =
    messages.length > 0 && messages.every((item) => specialUse(item.folder_id) === 'trash');
  const pending = messages.some((item) => item.pending_action);
  const flagged = messages.length > 0 && messages.every((item) => item.is_flagged);
  // Use only the visible messages returned for this row, including individually listed sent mail.
  const messageIds = messages.map((item) => item.id);
  const trashIds = messages
    .filter((item) => specialUse(item.folder_id) === 'trash')
    .map((item) => item.id);
  const sender = [...messages]
    .reverse()
    .find((item) => item.direction === 'inbound' && !item.is_mdn)?.from_address;
  const spamIds = sender
    ? messages
        .filter(
          (item) =>
            item.direction === 'inbound' &&
            !item.is_mdn &&
            !item.pending_action &&
            !['junk', 'trash'].includes(specialUse(item.folder_id) ?? '') &&
            normalizeRuleEmail(item.from_address) === normalizeRuleEmail(sender),
        )
        .map((item) => item.id)
    : [];
  const outbound = (message?.direction ?? thread.direction) === 'outbound';
  const addresses = outbound
    ? (message?.to_addresses ?? thread.latest_to ?? []).map((item) => item.address).join(', ')
    : (message?.from_address ?? thread.latest_from.address);
  const contactAddress =
    message && !message.is_mdn
      ? outbound
        ? message.to_addresses[0]
        : { address: message.from_address, name: message.from_name }
      : undefined;
  const contact =
    contactAddress && resolveAddress(contactAddress, detail.data?.contacts ?? {}).contact;
  const closeDialog = () => {
    setDialog(null);
    requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }));
  };
  const run = async (request: () => Promise<unknown>, confirmation: string) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await request();
      await Promise.all(
        ['threads', 'thread', 'folders', 'queue-counts', 'thread-history'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(confirmation);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const change = (action: string, confirmation: string, body?: object, method = 'POST') =>
    void run(() => api(threadPath + '/' + action, { method, body }), confirmation);
  const messageAction = (body: object, ids = messageIds) =>
    void run(
      () =>
        api('/mailboxes/' + mailboxId + '/messages/actions', {
          method: 'POST',
          body: { message_ids: ids, ...body },
        }),
      'Aplicando alteração no servidor…',
    );
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copiado.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };
  const error = box.isError || folders.isError || detail.isError;
  const loading = !box.data || !folders.data || !detail.data;
  return (
    <>
      <Menu.Root onOpenChange={setOpen}>
        <Menu.Trigger asChild>
          <div
            onContextMenu={(event) => {
              returnFocus.current =
                event.currentTarget.querySelector<HTMLButtonElement>('[data-mail-row-open]');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
              event.preventDefault();
              const anchor = (event.target as HTMLElement).getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: anchor.left + 12,
                  clientY: anchor.bottom,
                }),
              );
              returnFocus.current = event.target as HTMLElement;
            }}
          >
            {children}
          </div>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            className={menuClass}
            aria-label="Ações do e-mail"
            collisionPadding={8}
            onEscapeKeyDown={() =>
              requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }))
            }
          >
            <Menu.Label
              className="max-w-64 truncate px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
              title={thread.subject}
            >
              {thread.subject || '(Sem assunto)'}
            </Menu.Label>
            <Item onSelect={onOpen}>
              <Eye /> Abrir e-mail
            </Item>
            {error ? (
              <Item
                onSelect={(event) => {
                  event.preventDefault();
                  if (box.isError) void box.refetch();
                  if (folders.isError) void folders.refetch();
                  if (detail.isError) void detail.refetch();
                }}
              >
                <RotateCcw /> Tentar carregar ações novamente
              </Item>
            ) : loading || busy ? (
              <Item disabled>{busy ? 'Aplicando alteração…' : 'Carregando ações…'}</Item>
            ) : (
              <>
                {message && allowed('send') && (
                  <>
                    <Item onSelect={() => onCompose('reply:' + message.id)}>
                      <Reply /> Responder
                    </Item>
                    <Item onSelect={() => onCompose('reply_all:' + message.id)}>
                      <ReplyAll /> Responder a todos
                    </Item>
                    <Item onSelect={() => onCompose('forward:' + message.id)}>
                      <Forward /> Encaminhar
                    </Item>
                    <Item onSelect={() => onCompose('clone:' + message.id)}>
                      <Copy /> Clonar e-mail
                    </Item>
                  </>
                )}
                <Menu.Separator className="my-1 border-t" />
                <Item
                  onSelect={() =>
                    change(
                      thread.is_unread ? 'read' : 'unread',
                      thread.is_unread
                        ? 'E-mail marcado como lido.'
                        : 'E-mail marcado como não lido.',
                    )
                  }
                >
                  {thread.is_unread ? <MailOpen /> : <Mail />}{' '}
                  {thread.is_unread ? 'Marcar como lido' : 'Marcar como não lido'}
                </Item>
                <Group label="Organização" icon={<Tags />}>
                  <Item onSelect={() => setDialog('labels')}>
                    <Tags /> Etiquetas
                  </Item>
                  <Item
                    onSelect={() =>
                      change(
                        'pin',
                        detail.data?.is_pinned_personal ? 'E-mail desafixado.' : 'E-mail fixado.',
                      )
                    }
                  >
                    <Pin />{' '}
                    {detail.data?.is_pinned_personal ? 'Desafixar para mim' : 'Fixar para mim'}
                  </Item>
                  {mayRules && (
                    <Item
                      onSelect={() =>
                        change('pin', 'Fixação da caixa atualizada.', { scope: 'mailbox' })
                      }
                    >
                      <Pin />{' '}
                      {detail.data?.is_pinned_global
                        ? 'Desafixar para a caixa'
                        : 'Fixar para a caixa'}
                    </Item>
                  )}
                  {message && organize && flag && allowed('flag') && (
                    <Item
                      disabled={pending}
                      onSelect={() => messageAction({ type: 'set_flag', flagged: !flagged })}
                    >
                      <Flag /> {flagged ? 'Remover sinalização' : 'Sinalizar'}
                    </Item>
                  )}
                </Group>
                <Group label="Copiar" icon={<Clipboard />}>
                  <Item disabled={!thread.subject} onSelect={() => void copy(thread.subject)}>
                    Copiar assunto
                  </Item>
                  <Item disabled={!addresses} onSelect={() => void copy(addresses)}>
                    {outbound ? 'Copiar destinatários' : 'Copiar endereço do remetente'}
                  </Item>
                  <Item
                    disabled={!message?.body_text}
                    onSelect={() => void copy(message?.body_text ?? '')}
                  >
                    Copiar texto
                  </Item>
                </Group>
                {contacts &&
                  contactAddress?.address &&
                  (contact || createContact || editContact) && (
                    <Item onSelect={() => setDialog('contact')}>
                      <UserRoundPlus /> {contact ? 'Ver contato' : 'Adicionar aos contatos'}
                    </Item>
                  )}
                <Item onSelect={() => setDialog('share')}>
                  <MessageSquare /> Compartilhar no chat
                </Item>
                <Item onSelect={() => setDialog('print')}>
                  <Printer /> Imprimir
                </Item>
                <Group label="Tarefas e notas" icon={<ListTodo />}>
                  <Item onSelect={() => setDialog('tasks')}>
                    <ListTodo /> Tarefas do e-mail
                  </Item>
                  <Item onSelect={() => setDialog('notes')}>
                    <MessageSquare /> Notas internas
                  </Item>
                </Group>
                {rules && allowed('read') && (
                  <Group label="Regras" icon={<Workflow />}>
                    <Item onSelect={() => setDialog('rule')}>
                      Criar regra deste {outbound ? 'destinatário' : 'remetente'}
                    </Item>
                  </Group>
                )}
                {(canQueue || canAssign || canAssume) && (
                  <Group label="Atendimento e filas" icon={<ListChecks />}>
                    {canAssume && (
                      <Item
                        onSelect={() =>
                          change(
                            'assignee',
                            'Você assumiu este atendimento.',
                            { user_id: userId },
                            'PUT',
                          )
                        }
                      >
                        <UserCheck /> Assumir atendimento
                      </Item>
                    )}
                    {canAssign && (
                      <Item onSelect={() => setDialog('assign')}>
                        <UserRoundPlus /> Responsável
                      </Item>
                    )}
                    {canQueue && (
                      <>
                        <Item
                          disabled={
                            current.queue_status === 'done' || (current.pending_task_count ?? 0) > 0
                          }
                          onSelect={() => change('done', 'Conversa concluída.')}
                        >
                          <CheckCircle2 /> Marcar como concluída
                        </Item>
                        <Item onSelect={() => change('reopen', 'Conversa reaberta.')}>
                          <RotateCcw /> Reabrir conversa
                        </Item>
                        <Item
                          onSelect={() =>
                            change(
                              'queue-excluded',
                              'Filas atualizadas.',
                              { excluded: !current.queue_excluded },
                              'PUT',
                            )
                          }
                        >
                          {current.queue_excluded ? <Inbox /> : <CircleSlash />}
                          {current.queue_excluded ? 'Incluir nas filas' : 'Excluir das filas'}
                        </Item>
                      </>
                    )}
                  </Group>
                )}
                {message && organize && (
                  <>
                    <Menu.Separator className="my-1 border-t" />
                    {mayMove && (
                      <Item disabled={pending} onSelect={() => setDialog('move')}>
                        <FolderInput /> Mover para pasta
                      </Item>
                    )}
                    {mayMove &&
                      archive &&
                      messages.some((item) => item.folder_id !== archive.id) && (
                        <Item
                          disabled={pending}
                          onSelect={() =>
                            messageAction(
                              { type: 'move', target_folder_id: archive.id },
                              messages
                                .filter((item) => item.folder_id !== archive.id)
                                .map((item) => item.id),
                            )
                          }
                        >
                          <Archive /> Arquivar
                        </Item>
                      )}
                    {restore && allowed('restore') && trashIds.length > 0 && (
                      <Item
                        disabled={pending}
                        onSelect={() => messageAction({ type: 'restore' }, trashIds)}
                      >
                        <RotateCcw /> Restaurar da lixeira
                      </Item>
                    )}
                    {mayMove && mayRules && spamIds.length > 0 && (
                      <Item onSelect={() => setDialog('spam')}>
                        <ShieldAlert /> Marcar como spam
                      </Item>
                    )}
                    {remove && allowed('delete') && (
                      <Item
                        disabled={pending}
                        className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                        onSelect={() => setDialog('delete')}
                      >
                        <Trash2 /> {inTrash ? 'Remover da lixeira' : 'Excluir'}
                      </Item>
                    )}
                  </>
                )}
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {(dialog === 'move' || dialog === 'delete') && (
        <MessageActions
          mailboxId={mailboxId}
          folders={folders.data ?? []}
          messageIds={messageIds}
          inTrash={trashIds.length > 0}
          initialAction={dialog}
          hideTrigger
          onClose={closeDialog}
        />
      )}
      {dialog === 'contact' &&
        contactAddress &&
        (contact ? (
          <ContactEditorDialog
            id={contact.id}
            email={contactAddress.address}
            name={contactAddress.name}
            onClose={closeDialog}
          />
        ) : (
          <ContactAssociationDialog addresses={[contactAddress]} onClose={closeDialog} />
        ))}
      {dialog === 'share' && (
        <ShareToChatDialog threadId={thread.id} initialOpen hideTrigger onClose={closeDialog} />
      )}
      {dialog === 'print' && (
        <ConversationPdf
          threadId={thread.id}
          subject={thread.subject}
          initialOpen
          hideTrigger
          onClose={closeDialog}
        />
      )}
      {dialog === 'labels' && (
        <ThreadLabels
          threadIds={[thread.id]}
          labels={detail.data?.labels ?? thread.labels}
          mailboxId={mailboxId}
          presentation="dialog"
          onClose={closeDialog}
        />
      )}
      {dialog === 'rule' && box.data && (
        <RuleFromEmailDialog
          mailbox={box.data}
          thread={thread}
          message={message}
          onClose={closeDialog}
        />
      )}
      {dialog === 'spam' && sender && (
        <SpamConfirmation
          mailboxId={mailboxId}
          messageIds={spamIds}
          sender={sender}
          onClose={closeDialog}
        />
      )}
      {(dialog === 'tasks' || dialog === 'notes' || dialog === 'assign') && box.data && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) closeDialog();
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {dialog === 'tasks'
                  ? 'Tarefas do e-mail'
                  : dialog === 'notes'
                    ? 'Notas internas'
                    : 'Responsável pelo atendimento'}
              </DialogTitle>
            </DialogHeader>
            {dialog === 'tasks' && (
              <ThreadTasks threadId={thread.id} mailboxId={mailboxId} subject={thread.subject} />
            )}
            {dialog === 'notes' && (
              <ThreadNotes threadId={thread.id} mailboxId={mailboxId} role={box.data.role} />
            )}
            {dialog === 'assign' && (
              <ThreadAssignee
                mailboxId={mailboxId}
                threadIds={[thread.id]}
                role={box.data.role}
                assigned={current.assigned_to}
                iconOnly={false}
                onComplete={closeDialog}
                permissions={{
                  self: false,
                  others: allowed('assign_others'),
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
