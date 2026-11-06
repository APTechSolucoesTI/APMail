import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { can } from '@apmail/shared';
import { api, ApiError } from '@/lib/api';
import { useTenantId, meQuery, useAccess } from '@/lib/auth';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState, NoPermissionState } from '@/components/data/data-state';
import { QueueStatusBadge, OverdueBadge } from '@/components/common/status-badge';
import { MessageCard } from './message-card';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import type { ThreadDetail, Folder } from '@/lib/mail';
import { threadDetailKey } from '@/lib/mail';
import { LabelBadge } from './label-badge';
import { ThreadWorkflow } from './thread-workflow';
import { ThreadNotes } from './thread-notes';
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
  const mayClone = useAccess('mail.send');
  const [acting, setActing] = useState(false);
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
    organize = !data.delegated && can(data.my_role, 'organize'),
    queuesEnabled = data.mailbox?.queues_enabled !== false;
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
            data-mail-drag-ignore
          >
            <ArrowLeft />
          </Button>
          <h2 className="min-w-0 flex-1 select-text break-words text-xl font-semibold">
            {data.thread.subject || '(Sem assunto)'}
          </h2>
        </div>
        {(data.thread.queue_status !== 'none' || data.is_pinned_global) && (
          <div className="flex flex-wrap gap-2">
            <QueueStatusBadge status={data.thread.queue_status} />
            {queuesEnabled && data.thread.is_overdue && <OverdueBadge />}
            {data.is_pinned_global && (
              <Badge variant="secondary">
                <Pin className="size-3" aria-hidden /> Fixada para a caixa
              </Badge>
            )}
          </div>
        )}
        <ThreadWorkflow
          thread={data.thread}
          mailboxId={mailboxId}
          role={data.my_role}
          delegated={data.delegated}
        />
        {!!data.labels.length && (
          <div className="flex flex-wrap gap-1">
            {data.labels.map((label) => (
              <LabelBadge key={label.id} label={label} />
            ))}
          </div>
        )}
      </div>
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
          threadId={threadId}
          onClone={
            !data.delegated && mayClone && onCompose ? () => onCompose('clone:' + m.id) : undefined
          }
          contacts={data.contacts}
          timeZone={me.data?.preferences.timezone}
          expanded={i === 0 || !data.last_read_at || m.message_at > data.last_read_at}
          cidMap={data.cid_map}
          loadRemoteImages={me.data?.preferences.load_remote_images ?? false}
          organize={organize}
          mailboxId={mailboxId}
          folders={folders}
          onCompose={can(data.my_role, 'send') ? onCompose : undefined}
          allowForward={!data.delegated}
        />
      ))}
      <ThreadNotes
        key={threadId}
        threadId={threadId}
        mailboxId={mailboxId}
        role={data.my_role}
        subject={data.thread.subject}
        delegated={data.delegated}
      />
    </section>
  );
}
