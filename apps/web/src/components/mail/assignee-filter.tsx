import { useQueries } from '@tanstack/react-query';
import { can } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, type Mailbox } from '@/lib/auth';
export function AssigneeFilter({
  mailboxes,
  value,
  onChange,
  id = 'mail-assigned',
}: {
  mailboxes: Mailbox[];
  value?: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const tenant = useTenantId();
  const manageable = mailboxes.filter((box) => can(box.role, 'assign_others'));
  const queries = useQueries({
    queries: manageable.map((box) => ({
      queryKey: ['assignable', tenant, box.id],
      queryFn: () =>
        api<{ id: string; full_name: string }[]>('/mailboxes/' + box.id + '/assignable'),
    })),
  });
  const users = [
    ...new Map(
      queries.flatMap((query) => query.data ?? []).map((user) => [user.id, user]),
    ).values(),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'));
  return (
    <label className="block min-w-0 space-y-1 text-xs font-medium" htmlFor={id}>
      Responsável
      <select
        id={id}
        className="block h-11 w-full min-w-0 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
        value={value ?? 'any'}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="any">Todos</option>
        <option value="me">Minhas conversas</option>
        {manageable.length > 0 && <option value="unassigned">Sem responsável</option>}
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}
