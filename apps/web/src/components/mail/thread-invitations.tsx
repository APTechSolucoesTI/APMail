import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { MailActionButton } from './mail-action-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export type ThreadInvitation = {
  id: string;
  thread_id: string;
  mailbox_id: string;
  subject: string;
  mailbox_name: string;
  mailbox_email: string;
  inviter_name: string;
  created_at: string;
  state: string;
  user_id?: string;
  full_name?: string;
  email?: string;
};
export const threadInvitationsQuery = (tenant: string | null) => ({
  queryKey: ['thread-invitations', tenant],
  queryFn: () => api<ThreadInvitation[]>('/thread-invitations'),
  refetchInterval: 30000,
});
export function ThreadInvitations({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    tenant = useTenantId(),
    client = useQueryClient();
  const q = useQuery({
    queryKey: ['thread-invitations', tenant, threadId],
    queryFn: () =>
      api<{ items: ThreadInvitation[]; users: { id: string; full_name: string; email: string }[] }>(
        '/threads/' + threadId + '/invitations',
      ),
    enabled: open,
  });
  async function change(id?: string) {
    setBusy(true);
    try {
      await api('/threads/' + threadId + '/invitations' + (id ? '/' + id : ''), {
        method: id ? 'DELETE' : 'POST',
        ...(id ? {} : { body: { user_id: selected } }),
      });
      await client.invalidateQueries({ queryKey: ['thread-invitations'] });
      setSelected('');
      toast.success(id ? 'Convite encerrado.' : 'Convite criado.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <MailActionButton
        label="Convidar para a conversa"
        text="Convidar"
        onClick={() => setOpen(true)}
      >
        <UserPlus />
      </MailActionButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar para a conversa</DialogTitle>
            <DialogDescription>
              O acesso permite atender somente esta conversa e termina ao concluir o atendimento.
            </DialogDescription>
          </DialogHeader>
          {q.isPending ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState onRetry={() => void q.refetch()} />
          ) : (
            <div className="space-y-4">
              <label className="block space-y-2 text-sm">
                Usuário
                <select
                  aria-label="Usuário convidado"
                  className="h-11 w-full rounded-md border bg-card px-3"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Selecione um usuário</option>
                  {q.data.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email})
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={busy || !selected} onClick={() => void change()}>
                {busy ? 'Salvando…' : 'Convidar'}
              </Button>
              <ul className="space-y-2">
                {q.data.items
                  .filter((item) => item.state === 'active')
                  .map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <span>
                        {item.full_name ??
                          item.email ??
                          q.data.users.find((u) => u.id === item.user_id)?.full_name ??
                          'Usuário convidado'}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Encerrar convite"
                        disabled={busy}
                        onClick={() => void change(item.id)}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
