import { useState } from 'react';
import { Link, Outlet, createFileRoute, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Users, Mail } from 'lucide-react';
import { useChatConversations, useChatPresence } from '@/hooks/use-chat';
import { meQuery } from '@/lib/auth';
import { chatName, chatPreview } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/data/search-input';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';
import { UserAvatar } from '@/components/common/user-avatar';
import { NewConversation } from '@/components/chat/new-conversation';
export const Route = createFileRoute('/_app/chat')({ component: ChatLayout });
function ChatLayout() {
  const list = useChatConversations(),
    presence = useChatPresence(),
    me = useQuery(meQuery),
    { conversationId } = useParams({ strict: false }),
    [search, setSearch] = useState('');
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR');
  const rows = (list.data ?? []).filter((c) =>
    normalize(chatName(c, me.data?.user.id ?? '')).includes(normalize(search)),
  );
  return (
    <>
      <PageHeader title="Chat" description="Converse e compartilhe e-mails com sua equipe." />
      <div className="grid h-[calc(100dvh-12rem)] min-h-96 overflow-hidden rounded-lg border bg-card md:grid-cols-[320px_minmax(0,1fr)]">
        <aside
          aria-label="Conversas do chat"
          className={cn(
            'flex min-h-0 min-w-0 flex-col md:border-r',
            conversationId && 'hidden md:flex',
          )}
        >
          <div className="space-y-3 border-b p-4">
            <NewConversation />
            <SearchInput
              value={search}
              onChange={setSearch}
              debounce={0}
              placeholder="Buscar conversas por nome…"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? (
              <LoadingState />
            ) : list.error ? (
              <ErrorState onRetry={() => void list.refetch()} />
            ) : !rows.length ? (
              <EmptyState
                title={search ? 'Nenhuma conversa encontrada' : 'Sem conversas ainda'}
                description={
                  search
                    ? 'Ajuste a busca para encontrar uma pessoa ou grupo.'
                    : 'Use Nova conversa para falar com sua equipe.'
                }
              />
            ) : (
              rows.map((c) => {
                const person =
                  c.type === 'direct'
                    ? c.participants.find((p) => p.id !== me.data?.user.id)
                    : undefined;
                return (
                  <Link
                    key={c.id}
                    to="/chat/$conversationId"
                    params={{ conversationId: c.id }}
                    aria-current={c.id === conversationId ? 'page' : undefined}
                    className={cn(
                      'flex min-h-20 items-start gap-3 border-b p-4 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                      c.id === conversationId && 'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {person ? (
                      <UserAvatar
                        name={person.full_name}
                        src={person.avatar_url}
                        online={presence.data?.online_user_ids.includes(person.id) ?? false}
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Users className="size-4" aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold">
                        {chatName(c, me.data?.user.id ?? '')}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        {c.last_message?.is_shared && (
                          <Mail className="size-3 shrink-0" aria-hidden />
                        )}
                        <span className="truncate" title={chatPreview(c, me.data?.user.id ?? '')}>
                          {chatPreview(c, me.data?.user.id ?? '')}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-2">
                      {c.last_message && (
                        <time
                          dateTime={c.last_message.created_at}
                          title={new Date(c.last_message.created_at).toLocaleString('pt-BR')}
                          className="text-[11px] text-muted-foreground"
                        >
                          {new Date(c.last_message.created_at).toLocaleTimeString('pt-BR', {
                            timeZone: me.data?.preferences.timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      )}
                      {c.unread_count > 0 && (
                        <span
                          className="rounded-sm bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                          aria-label={`${c.unread_count} mensagens não lidas`}
                        >
                          {c.unread_count}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </aside>
        <div className={cn('min-h-0 min-w-0', !conversationId && 'hidden md:block')}>
          <Outlet />
        </div>
      </div>
    </>
  );
}
