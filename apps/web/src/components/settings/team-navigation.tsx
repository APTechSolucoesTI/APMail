import { Link } from '@tanstack/react-router';
import { UsersRound, ShieldCheck, UserRoundCog } from 'lucide-react';
import { useAccess } from '@/lib/auth';
export function TeamNavigation() {
  const profiles = useAccess('profiles.manage');
  const users = useAccess('users.manage');
  return (
    <nav aria-label="Equipe e acesso" className="mb-4 flex flex-wrap gap-1 border-b pb-2">
      <Link
        to="/admin/users"
        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted sm:min-h-9"
        activeProps={{ className: 'bg-secondary font-medium text-primary' }}
      >
        <UsersRound className="size-4" />
        Usuários
      </Link>
      {profiles && (
        <Link
          to="/admin/access-profiles"
          className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted sm:min-h-9"
          activeProps={{ className: 'bg-secondary font-medium text-primary' }}
        >
          <ShieldCheck className="size-4" />
          Perfis de acesso
        </Link>
      )}
      {users && (
        <Link
          to="/admin/user-permissions"
          className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted sm:min-h-9"
          activeProps={{ className: 'bg-secondary font-medium text-primary' }}
        >
          <UserRoundCog className="size-4" />
          Permissões por usuário
        </Link>
      )}
    </nav>
  );
}
