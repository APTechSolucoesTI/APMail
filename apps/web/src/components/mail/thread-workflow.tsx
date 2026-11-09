import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type MailboxRole } from '@apmail/shared';
import { CheckCircle2, RotateCcw, Play } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Thread } from '@/lib/mail';
import { MailActionButton } from './mail-action-button';
import { ThreadAssignee } from './thread-assignee';
import { ThreadInvitations } from './thread-invitations';
import { meQuery } from '@/lib/auth';
import { useThreadPresence } from '@/hooks/use-thread-presence';
export function ThreadWorkflow({
  thread,
  mailboxId,
  role,
  queuesEnabled,
  delegated = false,
}: {
  thread: Thread;
  mailboxId: string;
  role: MailboxRole;
  queuesEnabled: boolean;
  delegated?: boolean;
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    me = useQuery(meQuery),
    presence = useThreadPresence(thread.id).filter(
      (u) => u.user_id !== me.data?.user.id && u.composing,
    );
  const change = async (action: 'start' | 'done' | 'reopen') => {
    setBusy(true);
    try {
      await api('/threads/' + thread.id + '/' + action, { method: 'POST' });
      for (const key of [
        'thread',
        'threads',
        'queue-counts',
        'thread-history',
        'thread-invitations',
      ])
        void client.invalidateQueries({ queryKey: [key] });
      toast.success(
        action === 'start'
          ? 'Atendimento iniciado.'
          : action === 'done'
            ? 'Conversa concluída.'
            : 'Conversa reaberta.',
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!queuesEnabled && !presence.length) return null;
  return (
    <div className="space-y-3">
      {queuesEnabled && thread.assigned_to && (
        <p className="break-words text-xs text-muted-foreground">
          Responsável atual:{' '}
          <span className="font-semibold text-foreground">{thread.assigned_to.full_name}</span>
        </p>
      )}
      {queuesEnabled && (
        <div
          role="group"
          aria-label="Ações da conversa"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {!delegated && (
            <ThreadAssignee
              mailboxId={mailboxId}
              threadIds={[thread.id]}
              role={role}
              assigned={thread.assigned_to}
              showAssigned={false}
              iconOnly
            />
          )}
          {!delegated &&
            (can(role, 'assign_others') ||
              (can(role, 'send') && thread.assigned_to?.id === me.data?.user.id)) && (
              <ThreadInvitations threadId={thread.id} />
            )}
          {can(role, 'queue') && (
            <>
              {thread.queue_status !== 'done' && !thread.service_started_at && (
                <MailActionButton
                  label="Iniciar atendimento"
                  text="Iniciar atendimento"
                  disabled={busy}
                  onClick={() => void change('start')}
                >
                  <Play />
                </MailActionButton>
              )}
              {thread.queue_status === 'done' ? (
                <MailActionButton
                  label="Reabrir"
                  text="Reabrir"
                  disabled={busy}
                  onClick={() => void change('reopen')}
                >
                  <RotateCcw />
                </MailActionButton>
              ) : (
                <MailActionButton
                  label="Concluir"
                  text="Concluir"
                  disabled={busy || (thread.pending_task_count ?? 0) > 0}
                  onClick={() => void change('done')}
                >
                  <CheckCircle2 />
                </MailActionButton>
              )}
            </>
          )}
        </div>
      )}
      {queuesEnabled && can(role, 'queue') && (thread.pending_task_count ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground" role="status">
          {thread.pending_task_count === 1
            ? 'Conclua ou dispense a tarefa pendente antes de concluir a conversa.'
            : 'Conclua ou dispense as ' +
              thread.pending_task_count +
              ' tarefas pendentes antes de concluir a conversa.'}
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
