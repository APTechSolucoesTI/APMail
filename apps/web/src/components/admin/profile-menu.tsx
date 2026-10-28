import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, UserRound, ChevronDown } from 'lucide-react';
import { meQuery } from '@/lib/auth';
import { canAccessAdmin } from '@/lib/admin';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
export function ProfileMenu() {
  const me = useQuery(meQuery).data;
  if (!me) return null;
  const tenant = me.tenants.find((t) => t.id === me.current_tenant_id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="min-h-11 gap-1 px-1" aria-label="Abrir menu do perfil">
          <UserAvatar name={me.user.full_name} src={me.user.avatar_url ?? undefined} />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {canAccessAdmin(tenant ?? {}) && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck />
              Painel Administrativo
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/settings/profile">
            <UserRound />
            Meu perfil
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
