import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Building2,
  Globe2,
  Mail,
  UsersRound,
  Plug,
  ShieldCheck,
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  KeyRound,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { meQuery } from '@/lib/auth';
import { administrativeSections } from '@/lib/admin';
import { ScrollArea } from '@/components/ui/scroll-area';
const icons = [
  Globe2,
  Mail,
  UsersRound,
  KeyRound,
  Building2,
  Plug,
  ShieldCheck,
  BarChart3,
  ClipboardList,
];
export function AdminNavigation({ onNavigate }: { onNavigate: () => void }) {
  const me = useQuery(meQuery).data,
    tenant = me?.tenants.find((t) => t.id === me.current_tenant_id);
  return (
    <ScrollArea className="h-full">
      <nav aria-label="Navegação administrativa" className="flex min-h-full flex-col gap-1 p-3">
        <Link
          to="/admin"
          onClick={onNavigate}
          className="mb-4 flex items-center gap-2 px-2 py-3 text-xl font-semibold text-primary"
        >
          <ShieldCheck />
          APMail
        </Link>
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Painel Administrativo
        </p>
        <p className="mb-4 truncate px-2 text-sm" title={tenant?.name}>
          {tenant?.name}
        </p>
        <Link
          to="/admin"
          activeOptions={{ exact: true }}
          activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
          onClick={onNavigate}
          className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted sm:min-h-9"
        >
          <LayoutDashboard className="size-4" />
          Visão geral
        </Link>
        {administrativeSections(tenant ?? {}).map((s) => {
          const Icon =
            icons[
              [
                'Domínios',
                'Caixas de e-mail',
                'Equipe e acesso',
                'Perfis de acesso',
                'Empresa',
                'Integrações',
                'Antivírus',
                'Relatórios',
                'Auditoria',
              ].indexOf(s.label)
            ] ?? Building2;
          return (
            <Link
              key={s.path}
              to={s.path}
              onClick={onNavigate}
              activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
              className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted sm:min-h-9"
            >
              <Icon className="size-4" />
              {s.label}
            </Link>
          );
        })}
        <div className="mt-6 border-t pt-3">
          <Link
            to="/"
            onClick={onNavigate}
            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-primary hover:bg-muted"
          >
            <ArrowLeft className="size-4" />
            Voltar ao e-mail
          </Link>
        </div>
      </nav>
    </ScrollArea>
  );
}
