import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ellipsis, MailOpen, Pin, Tags, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { can, normalizeRuleEmail } from '@apmail/shared';
import { api, ApiError } from '@/lib/api';
import { useTenantId, meQuery, useMailQueues, useAccess } from '@/lib/auth';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { LoadingState, ErrorState, NoPermissionState } from '@/components/data/data-state';
import { QueueStatusBadge, OverdueBadge } from '@/components/common/status-badge';
import { MessageCard } from './message-card';
import { MessageActions } from './message-actions';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import type { ThreadDetail, Folder } from '@/lib/mail';
import { threadDetailKey } from '@/lib/mail';
import { flattenFolders } from '@/lib/mail';
import { ThreadLabels } from './thread-labels';
import { LabelBadge } from './label-badge';
import { ThreadWorkflow } from './thread-workflow';
import { ThreadNotes } from './thread-notes';
import { ShareToChatDialog } from '@/components/chat/share-to-chat-dialog';
import { SpamConfirmation } from './spam-confirmation';
import { ConversationPdf } from './conversation-pdf';
import { ThreadTasks } from './thread-tasks';
export function ThreadView({
  threadId,
  messageId,
  folderId,
  mailboxId,
  folders,
  onClose,
  onCompose,
}: {
  threadId: string;
  messageId?: string;
  folderId?: string;
  mailboxId: string;
  folders: Folder[];
  onClose: () => void;
  onCompose?: (mode: string) => void;
}) {
  const tenantId = useTenantId(),
    queuesEnabled = useMailQueues(),
    client = useQueryClient(),
    me = useQuery(meQuery);
  const q = useQuery({
    queryKey: threadDetailKey(tenantId, threadId, messageId, folderId),
    queryFn: () =>
      api<ThreadDetail>(
        '/threads/' +
          threadId +
          '?' +
          new URLSearchParams({
            ...(messageId ? { message_id: messageId } : {}),
            ...(folderId ? { folder_id: folderId } : {}),
          }),
      ),
  });
  useSocketRoom('thread', threadId);
  const [acting, setActing] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [spam, setSpam] = useState<{ sender: string; messageIds: string[] } | null>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const mayMove = useAccess('mail.move'),
    mayRule = useAccess('rules');
  const lastMessage = q.data?.messages.at(-1)?.message_at;
  useEffect(() => {
    if (!lastMessage || messageId || folderId) return;
    const timer = setTimeout(
      () =>
        void api('/threads/' + threadId + '/read', { method: 'POST' }).catch((e) =>
          toast.error(e.message),
        ),
      1000,
    );
    return () => clearTimeout(timer);
  }, [threadId, lastMessage, messageId, folderId]);
  const action = async (type: string, scope?: 'mailbox') => {
    setActing(true);
    try {
      await api('/threads/' + threadId + '/' + type, {
        method: 'POST',
        ...(scope ? { body: { scope } } : {}),
      });
      await client.invalidateQueries({ queryKey: ['thread', tenantId, threadId] });
      if (type === 'unread') onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar a conversa.');
    } finally {
      setActing(false);
    }
  };
  if (q.isLoading) return <LoadingState />;
  if (q.error instanceof ApiError && [403, 404].includes(q.error.status))
    return (
      <div className="space-y-3 p-4">
        <NoPermissionState />
        <Button variant="outline" onClick={onClose}>
          Voltar à lista
        </Button>
      </div>
    );
  if (!q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  const data = q.data,
    organize = can(data.my_role, 'organize');
  const sender = [...data.messages]
    .reverse()
    .find((m) => m.direction === 'inbound' && !m.is_mdn)?.from_address;
  const excludedFolders = new Set(
    flattenFolders(folders)
      .filter((f) => ['junk', 'trash'].includes(f.special_use ?? ''))
      .map((f) => f.id),
  );
  const spamMessageIds = sender
    ? data.messages
        .filter(
          (m) =>
            m.direction === 'inbound' &&
            !m.is_mdn &&
            !m.pending_action &&
            !excludedFolders.has(m.folder_id ?? '') &&
            normalizeRuleEmail(m.from_address) === normalizeRuleEmail(sender),
        )
        .map((m) => m.id)
    : [];
  return (
    <section aria-label="Conversa" className="h-full min-w-0 space-y-4 overflow-y-auto p-3 sm:p-4">
      <div className="space-y-3 border-b pb-4">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Voltar à lista"
            onClick={onClose}
          >
            <ArrowLeft />
          </Button>
          <h2 className="min-w-0 flex-1 break-words text-xl font-semibold">
            {data.thread.subject || data.messages[0]?.subject || '(Sem assunto)'}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {queuesEnabled && <QueueStatusBadge status={data.thread.queue_status} />}
          {queuesEnabled && data.thread.is_overdue && <OverdueBadge />}
          {data.is_pinned_global && (
            <Badge variant="secondary">
              <Pin className="size-3" aria-hidden /> Fixada para a caixa
            </Badge>
          )}
        </div>
        <ThreadWorkflow thread={data.thread} mailboxId={mailboxId} role={data.my_role}>
          <ConversationPdf threadId={threadId} subject={data.thread.subject} />
          <ShareToChatDialog threadId={threadId} />
          {organize && (
            <MessageActions
              mailboxId={mailboxId}
              folders={folders}
              inTrash={
                data.messages.length > 0 &&
                data.messages.every((message) =>
                  flattenFolders(folders).some(
                    (folder) => folder.id === message.folder_id && folder.special_use === 'trash',
                  ),
                )
              }
              {...(messageId || folderId
                ? { messageIds: data.messages.map((message) => message.id) }
                : { threadIds: [threadId] })}
              compact
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={moreTrigger} size="sm" variant="outline" disabled={acting}>
                <Ellipsis />
                Mais ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setLabelsOpen(true)}>
                <Tags />
                Etiquetas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {organize &&
                can(data.my_role, 'rules') &&
                mayMove &&
                mayRule &&
                sender &&
                spamMessageIds.length > 0 && (
                  <DropdownMenuItem
                    onSelect={() => setSpam({ sender, messageIds: spamMessageIds })}
                  >
                    <ShieldAlert />
                    Marcar como spam
                  </DropdownMenuItem>
                )}
              <DropdownMenuItem onSelect={() => void action('unread')}>
                <MailOpen />
                Marcar como não lida
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void action('pin')}>
                <Pin />
                {data.is_pinned_personal ? 'Desafixar para mim' : 'Fixar para mim'}
              </DropdownMenuItem>
              {can(data.my_role, 'rules') && (
                <DropdownMenuItem onSelect={() => void action('pin', 'mailbox')}>
                  <Pin />
                  {data.is_pinned_global ? 'Desafixar para a caixa' : 'Fixar para a caixa'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </ThreadWorkflow>
        {spam && (
          <SpamConfirmation
            mailboxId={mailboxId}
            messageIds={spam.messageIds}
            sender={spam.sender}
            onClose={() => setSpam(null)}
            returnFocusRef={moreTrigger}
          />
        )}
        {labelsOpen && (
          <ThreadLabels
            key={threadId}
            threadIds={[threadId]}
            labels={data.labels}
            mailboxId={mailboxId}
            presentation="dialog"
            onClose={() => setLabelsOpen(false)}
          />
        )}
        {!!data.labels.length && (
          <div className="flex flex-wrap gap-1">
            {data.labels.map((label) => (
              <LabelBadge key={label.id} label={label} />
            ))}
          </div>
        )}
      </div>
      <ThreadTasks threadId={threadId} mailboxId={mailboxId} subject={data.thread.subject} />
      {data.pending_outbox?.map((o) => (
        <div key={o.id} className="rounded-md border bg-secondary p-3 text-sm">
          <p>
            {o.scheduled_at
              ? `Resposta agendada por ${o.created_by_name} para ${new Date(o.scheduled_at).toLocaleString('pt-BR', { timeZone: me.data?.preferences.timezone, timeZoneName: 'short' })}`
              : `Resposta ${o.status === 'sending' ? 'em envio' : 'na fila'} por ${o.created_by_name}`}
          </p>

          {o.status !== 'sending' &&
            (o.created_by === me.data?.user.id ||
              (o.status === 'scheduled' && can(data.my_role, 'cancel_any'))) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {o.created_by === me.data?.user.id && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={acting}
                      onClick={async () => {
                        setActing(true);
                        try {
                          await api('/outbox/' + o.id + '/cancel', { method: 'POST' });
                          onCompose?.('draft:' + o.id);
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setActing(false);
                        }
                      }}
                    >
                      Editar
                    </Button>
                    {o.status === 'scheduled' && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="outline" size="sm">
                            Enviar agora
                          </Button>
                        }
                        title="Enviar agora?"
                        description="A resposta será colocada imediatamente na fila."
                        onConfirm={() => api('/outbox/' + o.id + '/send-now', { method: 'POST' })}
                      />
                    )}
                  </>
                )}
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      Cancelar envio
                    </Button>
                  }
                  title="Cancelar envio?"
                  description="A resposta será retirada da fila antes do envio."
                  onConfirm={() => api('/outbox/' + o.id + '/cancel', { method: 'POST' })}
                />
              </div>
            )}
        </div>
      ))}
      {[...data.messages].reverse().map((m, i) => (
        <MessageCard
          key={m.id}
          message={m}
          contacts={data.contacts}
          timeZone={me.data?.preferences.timezone}
          expanded={i === 0 || !data.last_read_at || m.message_at > data.last_read_at}
          cidMap={data.cid_map}
          loadRemoteImages={me.data?.preferences.load_remote_images ?? false}
          organize={organize}
          mailboxId={mailboxId}
          folders={folders}
          onCompose={can(data.my_role, 'send') ? onCompose : undefined}
        />
      ))}
      <ThreadNotes key={threadId} threadId={threadId} mailboxId={mailboxId} role={data.my_role} />
    </section>
  );
}
