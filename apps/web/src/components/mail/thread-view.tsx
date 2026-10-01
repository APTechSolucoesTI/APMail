import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MailOpen, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { can } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { QueueStatusBadge } from '@/components/common/status-badge';
import { MessageCard } from './message-card';
import { MessageActions } from './message-actions';
import type { ThreadDetail, Folder } from '@/lib/mail';
export function ThreadView({
  threadId,
  mailboxId,
  folders,
  onClose,
}: {
  threadId: string;
  mailboxId: string;
  folders: Folder[];
  onClose: () => void;
}) {
  const tenantId = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery);
  const q = useQuery({
    queryKey: ['thread', tenantId, threadId],
    queryFn: () => api<ThreadDetail>('/threads/' + threadId),
  });
  useSocketRoom('thread', threadId);
  const [acting, setActing] = useState(false);
  const lastMessage = q.data?.messages.at(-1)?.message_at;
  useEffect(() => {
    if (!lastMessage) return;
    const timer = setTimeout(
      () =>
        void api('/threads/' + threadId + '/read', { method: 'POST' }).catch((e) =>
          toast.error(e.message),
        ),
      1000,
    );
    return () => clearTimeout(timer);
  }, [threadId, lastMessage]);
  const action = async (type: string) => {
    setActing(true);
    try {
      await api('/threads/' + threadId + '/' + type, { method: 'POST' });
      await client.invalidateQueries({ queryKey: ['thread', tenantId, threadId] });
      if (type === 'unread') onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar a conversa.');
    } finally {
      setActing(false);
    }
  };
  if (q.isLoading) return <LoadingState />;
  if (!q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  const data = q.data,
    organize = can(data.my_role, 'organize');
  return (
    <section aria-label="Conversa" className="h-full space-y-4 overflow-y-auto p-4">
      <div className="space-y-3 border-b pb-4">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon" aria-label="Voltar à lista" onClick={onClose}>
            <ArrowLeft />
          </Button>
          <h2 className="min-w-0 flex-1 break-words text-xl font-semibold">
            {data.thread.subject || data.messages[0]?.subject || '(Sem assunto)'}
          </h2>
        </div>
        <QueueStatusBadge status={data.thread.queue_status} />
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={acting}
            onClick={() => void action('unread')}
          >
            <MailOpen />
            Marcar como não lida
          </Button>
          <Button size="sm" variant="outline" disabled={acting} onClick={() => void action('pin')}>
            <Pin />
            {data.is_pinned ? 'Desafixar' : 'Fixar'}
          </Button>
        </div>
        {organize && (
          <MessageActions mailboxId={mailboxId} folders={folders} threadIds={[threadId]} />
        )}
      </div>
      {data.messages.map((m, i) => (
        <MessageCard
          key={m.id}
          message={m}
          expanded={
            i === data.messages.length - 1 || !data.last_read_at || m.message_at > data.last_read_at
          }
          cidMap={data.cid_map}
          loadRemoteImages={me.data?.preferences.load_remote_images ?? false}
          organize={organize}
          mailboxId={mailboxId}
          folders={folders}
        />
      ))}
    </section>
  );
}
