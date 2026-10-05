import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, Check, UserCheck } from 'lucide-react';
import { can, canDelegate, type MailboxRole } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command';
import { UserAvatar } from '@/components/common/user-avatar';
type User = { id: string; full_name: string; avatar_url: string | null };
export function ThreadAssignee({
  mailboxId,
  threadIds,
  role,
  assigned,
  showAssigned = true,
  onComplete,
}: {
  mailboxId: string;
  threadIds: string[];
  role: MailboxRole;
  assigned?: User | null;
  showAssigned?: boolean;
  onComplete?: () => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    users = useQuery({
      queryKey: ['assignable', tenant, mailboxId],
      queryFn: () => api<User[]>('/mailboxes/' + mailboxId + '/assignable'),
      enabled:
        can(role, 'assign_others') ||
        canDelegate(
          me.data?.tenants.find((t) => t.id === tenant)?.role ?? null,
          me.data?.tenants.find((t) => t.id === tenant)?.capabilities,
          'assign_others',
        ),
    });
  const assign = async (userId: string | null) => {
    setBusy(true);
    try {
      if (threadIds.length === 1)
        await api('/threads/' + threadIds[0] + '/assignee', {
          method: 'PUT',
          body: { user_id: userId },
        });
      else
        await api('/mailboxes/' + mailboxId + '/threads/bulk', {
          method: 'POST',
          body: { thread_ids: threadIds, action: 'assign', user_id: userId },
        });
      for (const key of ['thread', 'threads', 'queue-counts', 'thread-history'])
        void client.invalidateQueries({ queryKey: [key] });
      setOpen(false);
      onComplete?.();
      toast.success('Responsável atualizado.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {assigned && showAssigned && (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm">
          <UserAvatar name={assigned.full_name} src={assigned.avatar_url} size={24} />
          <span className="truncate" title={assigned.full_name}>
            {assigned.full_name}
          </span>
        </span>
      )}
      {can(role, 'assign_self') && assigned?.id !== me.data?.user.id && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void assign(me.data!.user.id)}
        >
          <UserCheck />
          {busy ? 'Atribuindo…' : 'Assumir'}
        </Button>
      )}
      {(can(role, 'assign_others') ||
        canDelegate(
          me.data?.tenants.find((t) => t.id === tenant)?.role ?? null,
          me.data?.tenants.find((t) => t.id === tenant)?.capabilities,
          'assign_others',
        )) && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              role="combobox"
              aria-label="Atribuir responsável"
              aria-expanded={open}
              disabled={busy}
            >
              Atribuir
              <ChevronsUpDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Buscar responsável…" aria-label="Buscar responsável" />
              <CommandList>
                <CommandEmpty>Nenhum responsável encontrado.</CommandEmpty>
                <CommandItem
                  value="Sem responsável"
                  onSelect={() => void assign(null)}
                  className="min-h-11"
                >
                  Sem responsável
                </CommandItem>
                {users.data?.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.full_name + ' ' + u.id}
                    onSelect={() => void assign(u.id)}
                    className="min-h-11"
                  >
                    <span aria-hidden>
                      <UserAvatar name={u.full_name} src={u.avatar_url} size={24} />
                    </span>
                    {u.full_name}
                    {u.id === assigned?.id && <Check className="ml-auto size-4" />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            {users.isError && (
              <p className="p-3 text-sm text-danger-fg" role="alert">
                Não foi possível carregar responsáveis.
              </p>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
