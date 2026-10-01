import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type MailboxRole } from '@apmail/shared';
import { ChevronDown, CheckCircle2, RotateCcw, Inbox, CircleSlash } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Thread } from '@/lib/mail';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ThreadAssignee } from './thread-assignee';
import { meQuery } from '@/lib/auth';
import { useThreadPresence } from '@/hooks/use-thread-presence';
export function ThreadWorkflow({
  thread,
  mailboxId,
  role,
}: {
  thread: Thread;
  mailboxId: string;
  role: MailboxRole;
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    me = useQuery(meQuery),
    presence = useThreadPresence(thread.id).filter(
      (u) => u.user_id !== me.data?.user.id && u.composing,
    );
  const change = async (action: string) => {
    setBusy(true);
    try {
      await api(
        '/threads/' + thread.id + '/' + (action === 'excluded' ? 'queue-excluded' : action),
        {
          method: action === 'excluded' ? 'PUT' : 'POST',
          ...(action === 'excluded' ? { body: { excluded: !thread.queue_excluded } } : {}),
        },
      );
      for (const key of ['thread', 'threads', 'queue-counts', 'thread-history'])
        void client.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {thread.assigned_to && (
        <p className="rounded-md border bg-secondary p-3 text-sm text-secondary-foreground">
          Conversa atribuída a <span className="font-semibold">{thread.assigned_to.full_name}</span>
          .
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {can(role, 'queue') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>
                {busy ? 'Atualizando…' : 'Status'}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={thread.queue_status === 'done'}
                onSelect={() => void change('done')}
              >
                <CheckCircle2 />
                Marcar como concluída
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void change('reopen')}>
                <RotateCcw />
                Reabrir conversa
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void change('excluded')}>
                {thread.queue_excluded ? <Inbox /> : <CircleSlash />}
                {thread.queue_excluded ? 'Incluir nas filas' : 'Excluir das filas'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ThreadAssignee
          mailboxId={mailboxId}
          threadIds={[thread.id]}
          role={role}
          assigned={thread.assigned_to}
        />
      </div>
      {thread.queue_excluded && (
        <p className="rounded-md border bg-muted p-3 text-sm">
          Esta conversa está fora das filas operacionais.
        </p>
      )}
      {!!presence.length && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-info/30 bg-info-bg p-3 text-sm text-info-fg"
        >
          {presence.map((u) => u.full_name).join(', ')}{' '}
          {presence.length === 1 ? 'está respondendo…' : 'estão respondendo…'}
        </p>
      )}
    </div>
  );
}
