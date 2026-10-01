import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import type { SharedThreadSnapshot } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
export function SharedEmailCard({
  threadId,
  snapshot,
}: {
  threadId: string;
  snapshot: SharedThreadSnapshot;
}) {
  const me = useQuery(meQuery),
    access = useQuery({
      queryKey: ['shared-thread-access', useTenantId(), threadId, me.data?.user.id],
      queryFn: ({ signal }) =>
        api<{ allowed: boolean }>('/chat/shared-threads/' + threadId + '/access', { signal }),
      retry: false,
      refetchInterval: 30000,
    });
  return (
    <article className="mt-2 min-w-0 space-y-2 rounded-md border bg-card p-3 text-card-foreground">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="size-4 shrink-0" aria-hidden />
        {snapshot.mailbox_name}
      </p>
      <h3 className="break-words text-sm font-semibold">{snapshot.subject || '(Sem assunto)'}</h3>
      <p className="break-words text-xs">{snapshot.from_name || snapshot.from_address}</p>
      <time dateTime={snapshot.message_at} className="block text-xs text-muted-foreground">
        {new Date(snapshot.message_at).toLocaleString('pt-BR', {
          timeZone: me.data?.preferences.timezone,
        })}
      </time>
      <p className="line-clamp-2 break-words text-xs">{snapshot.snippet}</p>
      {snapshot.snippet && (
        <details className="text-xs">
          <summary className="cursor-pointer py-1 focus-visible:ring-2 focus-visible:ring-ring">
            Ver resumo completo
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{snapshot.snippet}</p>
        </details>
      )}
      {access.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Verificando acesso…
        </p>
      ) : access.data?.allowed ? (
        <Button variant="outline" className="min-h-11" asChild>
          <Link
            to="/mail/$mailboxId"
            params={{ mailboxId: snapshot.mailbox_id }}
            search={{ thread: threadId }}
          >
            Abrir conversa
          </Link>
        </Button>
      ) : (
        <>
          <Button variant="outline" disabled>
            Abrir conversa
          </Button>
          <p className="text-xs text-muted-foreground">Você não tem acesso a esta caixa</p>
        </>
      )}
    </article>
  );
}
