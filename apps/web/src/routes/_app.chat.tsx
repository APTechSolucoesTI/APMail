import { Outlet, Link, createFileRoute, useParams } from '@tanstack/react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { listQuerySchema, type ListResult, type ChatConversation } from '@apmail/shared';
import { api } from '@/lib/api';
import { tableParameters } from '@/lib/table-query';
import { useTenantId, meQuery } from '@/lib/auth';
import { chatName, chatPreview } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { NewConversation } from '@/components/chat/new-conversation';
export const Route = createFileRoute('/_app/chat')({
  validateSearch: listQuerySchema,
  component: ChatLayout,
});
function ChatLayout() {
  const query = Route.useSearch(),
    navigate = Route.useNavigate(),
    tenant = useTenantId(),
    me = useQuery(meQuery),
    { conversationId } = useParams({ strict: false });
  const list = useQuery({
    queryKey: ['chat-conversations', tenant, me.data?.user.id, query],
    queryFn: ({ signal }) =>
      api<ListResult<ChatConversation>>(
        '/chat/conversations/list?' +
          new URLSearchParams({
            ...tableParameters(query),
            page: String(query.page),
            pageSize: String(query.pageSize),
            search: query.search ?? '',
          }),
        { signal },
      ),
    refetchInterval: 60000,
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Chat" description="Converse e compartilhe e-mails com sua equipe." />
      <div className="grid h-[calc(100dvh-12rem)] min-h-96 overflow-hidden rounded-lg border bg-card md:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <aside
          aria-label="Conversas do chat"
          className={cn(
            'min-h-0 min-w-0 overflow-y-auto md:border-r',
            conversationId && 'hidden md:block',
          )}
        >
          <ConfigurableTable
            listKey="chat-conversations"
            mode="server"
            query={query}
            onQueryChange={(search) => void navigate({ search })}
            data={list.data?.items ?? []}
            total={list.data?.total ?? 0}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.error}
            onRetry={() => void list.refetch()}
            toolbarLeft={<NewConversation />}
            columns={[
              {
                id: 'name',
                header: 'Conversa',
                hideable: false,
                cell: (c) => (
                  <Link
                    to="/chat/$conversationId"
                    params={{ conversationId: c.id }}
                    search={query}
                    aria-current={c.id === conversationId ? 'page' : undefined}
                    className="text-primary hover:underline"
                  >
                    {chatName(c, me.data?.user.id ?? '')}
                  </Link>
                ),
              },
              {
                id: 'preview',
                header: 'Última mensagem',
                defaultVisible: false,
                cell: (c) => chatPreview(c, me.data?.user.id ?? ''),
              },
              { id: 'unread_count', header: 'Não lidas', align: 'right' },
              {
                id: 'last_message_at',
                header: 'Data e hora',
                defaultVisible: false,
                cell: (c) =>
                  c.last_message
                    ? new Date(c.last_message.created_at).toLocaleString('pt-BR', {
                        timeZone: me.data?.preferences.timezone,
                      })
                    : '',
              },
            ]}
          />
        </aside>
        <main className={cn('min-h-0 min-w-0', !conversationId && 'hidden md:block')}>
          <Outlet />
        </main>
      </div>
    </>
  );
}
