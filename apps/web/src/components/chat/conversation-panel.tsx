import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { chatName, upsertChatMessage, type ChatLocalMessage, type ChatPages } from '@/lib/chat';
import {
  useChatConversations,
  useChatMessages,
  useChatPresence,
  useChatTyping,
} from '@/hooks/use-chat';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { Button } from '@/components/ui/button';
import {
  LoadingState,
  ErrorState,
  EmptyState,
  NoPermissionState,
} from '@/components/data/data-state';
import { UserAvatar } from '@/components/common/user-avatar';
import { ChatInput } from './chat-input';
import { MessageBubble } from './message-bubble';
import { GroupParticipants } from './group-participants';
function dayKey(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
function dayLabel(value: string, timezone: string) {
  const today = dayKey(new Date().toISOString(), timezone),
    yesterday = new Date(new Date(today + 'T12:00:00Z').getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
  return value === today
    ? 'Hoje'
    : value === yesterday
      ? 'Ontem'
      : value.split('-').reverse().join('/');
}
export function ConversationPanel({ id }: { id: string }) {
  const client = useQueryClient(),
    tenant = useTenantId(),
    me = useQuery(meQuery),
    conversations = useChatConversations(),
    query = useChatMessages(id),
    presence = useChatPresence(),
    typing = useChatTyping(id);
  useSocketRoom('chat', conversations.data?.some((c) => c.id === id) ? id : undefined);
  const area = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    previous = useRef<{ height: number; top: number } | null>(null),
    bottom = useRef(true),
    seen = useRef(''),
    [atBottom, setAtBottom] = useState(true),
    [visible, setVisible] = useState(document.visibilityState === 'visible'),
    [now, setNow] = useState(() => Date.now());
  const messages = [
    ...new Map((query.data?.pages.flat() ?? []).map((message) => [message.id, message])).values(),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const newest = messages.at(-1)?.id,
    count = messages.length,
    user = me.data?.user,
    timezone = me.data?.preferences.timezone ?? 'America/Sao_Paulo';
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000),
      changed = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', changed);
    };
  }, []);
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    if (previous.current) {
      node.scrollTop = previous.current.top + node.scrollHeight - previous.current.height;
      previous.current = null;
    } else if (bottom.current) node.scrollTop = node.scrollHeight;
  }, [count, newest]);
  useEffect(() => {
    const node = area.current,
      inner = content.current;
    if (!node || !inner) return;
    const observer = new ResizeObserver(() => {
      if (bottom.current && !previous.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [query.isLoading]);
  useEffect(() => {
    if (
      !newest ||
      newest.startsWith('local-') ||
      !atBottom ||
      !visible ||
      seen.current === newest ||
      query.error
    )
      return;
    seen.current = newest;
    void api('/chat/conversations/' + id + '/read', { method: 'POST' })
      .then(() => client.invalidateQueries({ queryKey: ['chat-conversations', tenant] }))
      .catch(() => {
        seen.current = '';
      });
  }, [newest, atBottom, visible, id, tenant, client, query.error]);
  const send = async (body: string, clientId: string = crypto.randomUUID()) => {
    if (!user) return;
    const key = ['chat-messages', tenant, id, user.id],
      optimistic: ChatLocalMessage = {
        id: 'local-' + clientId,
        conversation_id: id,
        sender_id: user.id,
        sender: { id: user.id, full_name: user.full_name, avatar_url: user.avatar_url },
        client_id: clientId,
        body,
        shared_thread_id: null,
        shared_snapshot: null,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        delivery: 'sending',
      };
    await client.cancelQueries({ queryKey: key });
    bottom.current = true;
    setAtBottom(true);
    client.setQueryData<ChatPages>(key, (data) => upsertChatMessage(data, optimistic));
    try {
      const message = await api<ChatLocalMessage>('/chat/conversations/' + id + '/messages', {
        method: 'POST',
        body: { body, client_id: clientId },
      });
      client.setQueryData<ChatPages>(key, (data) => upsertChatMessage(data, message));
      void client.invalidateQueries({ queryKey: ['chat-conversations', tenant] });
    } catch (e) {
      client.setQueryData<ChatPages>(key, (data) => {
        const existing = data?.pages
          .flat()
          .find((m) => m.client_id === clientId && m.sender_id === user.id);
        return existing && !existing.delivery
          ? data
          : upsertChatMessage(data, { ...optimistic, delivery: 'failed' });
      });
      toast.error((e as Error).message);
    }
  };
  const conversation = conversations.data?.find((c) => c.id === id);
  if (query.isLoading || conversations.isLoading) return <LoadingState />;
  if (
    (query.error instanceof ApiError && [403, 404, 409].includes(query.error.status)) ||
    (conversations.data && !conversation)
  )
    return (
      <div className="p-4">
        <NoPermissionState />
        <Button variant="outline" asChild>
          <Link to="/chat">Voltar às conversas</Link>
        </Button>
      </div>
    );
  if (!query.data || !conversation || !user)
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch();
          void conversations.refetch();
        }}
      />
    );
  const person =
    conversation.type === 'direct'
      ? conversation.participants.find((p) => p.id !== user.id)
      : undefined;
  return (
    <section aria-label="Conversa do chat" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" asChild className="md:hidden">
            <Link to="/chat" aria-label="Voltar às conversas">
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </Button>
          {person && (
            <UserAvatar
              name={person.full_name}
              src={person.avatar_url}
              online={presence.data?.online_user_ids.includes(person.id) ?? false}
            />
          )}
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold">
              {chatName(conversation, user.id)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {person
                ? presence.data?.online_user_ids.includes(person.id)
                  ? 'Online'
                  : 'Offline'
                : `${conversation.participants.length} participantes`}
            </p>
          </div>
        </div>
        {conversation.type === 'group' && <GroupParticipants conversation={conversation} />}
      </header>
      <div
        ref={area}
        className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        tabIndex={0}
        role="log"
        aria-label="Mensagens da conversa"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(event) => {
          const node = event.currentTarget,
            near = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          bottom.current = near;
          setAtBottom(near);
        }}
      >
        <div ref={content} className="space-y-4">
          {query.hasNextPage && (
            <div className="text-center">
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => {
                  const node = area.current;
                  if (node) previous.current = { height: node.scrollHeight, top: node.scrollTop };
                  void query.fetchNextPage().catch(() => {
                    previous.current = null;
                  });
                }}
              >
                {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
              </Button>
            </div>
          )}
          {!messages.length && (
            <EmptyState
              title="Inicie a conversa"
              description="Envie uma mensagem para falar com a equipe."
            />
          )}
          {messages.map((message, index) => {
            const prior = messages[index - 1],
              day = dayKey(message.created_at, timezone),
              newDay = !prior || dayKey(prior.created_at, timezone) !== day;
            return (
              <div key={message.id} className="space-y-4">
                {newDay && (
                  <p className="text-center text-xs text-muted-foreground">
                    {dayLabel(day, timezone)}
                  </p>
                )}
                <MessageBubble
                  message={message}
                  own={message.sender_id === user.id}
                  userId={user.id}
                  timezone={timezone}
                  now={now}
                  showSender={
                    conversation.type === 'group' &&
                    (newDay || prior?.sender_id !== message.sender_id)
                  }
                  onRetry={(message) => {
                    if (message.client_id) void send(message.body, message.client_id);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {query.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-t p-3 text-xs text-danger-fg"
        >
          Não foi possível atualizar as mensagens.
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw className="size-4" aria-hidden />
            Tentar novamente
          </Button>
        </div>
      )}
      {!atBottom && (
        <Button
          variant="outline"
          className="mx-4 mb-2"
          onClick={() => {
            if (area.current) area.current.scrollTop = area.current.scrollHeight;
            bottom.current = true;
            setAtBottom(true);
          }}
        >
          <ArrowDown className="size-4" aria-hidden />
          Ver mensagens recentes
        </Button>
      )}
      <p role="status" aria-live="polite" className="min-h-6 px-4 text-xs text-muted-foreground">
        {typing.users.length > 0
          ? typing.users.join(', ') +
            (typing.users.length === 1 ? ' está digitando…' : ' estão digitando…')
          : ''}
      </p>
      <ChatInput disabled={!!query.error} onSend={(body) => send(body)} onTyping={typing.notify} />
    </section>
  );
}
