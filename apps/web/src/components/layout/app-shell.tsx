import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { Mail, Menu, Settings, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { meQuery, TenantContext, type Mailbox } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserAvatar } from '@/components/common/user-avatar';
import { NotificationBell } from './notification-bell';
import { useTheme } from './theme-provider';
import { TableUserContext } from '@/hooks/use-table-preferences';
export function AppShell() {
  const me = useQuery(meQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const boxes = useQuery({
    queryKey: ['mailboxes', me.data?.current_tenant_id],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const [open, setOpen] = useState(false);
  const { setTheme } = useTheme();
  const theme = me.data?.preferences.theme;
  useEffect(() => {
    if (theme) setTheme(theme);
  }, [theme, setTheme]);
  useEffect(() => {
    const socket = io({ withCredentials: true });
    socket.on('connect', () => {
      void client.invalidateQueries({ queryKey: ['mailboxes'] });
      void client.invalidateQueries({ queryKey: ['me'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    });
    socket.on('mailboxes:changed', () => {
      void client.invalidateQueries({ queryKey: ['mailboxes'] });
      void client.invalidateQueries({ queryKey: ['mailbox'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    });
    socket.on(
      'notification:new',
      () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    );
    socket.on('disconnect', () => void client.invalidateQueries({ queryKey: ['me'] }));
    return () => {
      socket.disconnect();
    };
  }, [client, me.data?.current_tenant_id]);
  useEffect(() => {
    if (me.error && 'status' in me.error && me.error.status === 401)
      void navigate({ to: '/login' });
    else if (me.data && !me.data.current_tenant_id) void navigate({ to: '/onboarding' });
  }, [me.error, me.data, navigate]);
  if (!me.data)
    return (
      <div role="status" className="p-6">
        Carregando sua equipe…
      </div>
    );
  const tenant = me.data.tenants.find((t) => t.id === me.data!.current_tenant_id);
  const admin = tenant?.role !== 'member';
  const sidebar = (
    <nav aria-label="Navegação principal" className="flex h-full flex-col gap-2 p-4">
      <Link
        to="/"
        className="mb-6 flex items-center gap-2 text-xl font-semibold text-primary"
        onClick={() => setOpen(false)}
      >
        <Mail aria-hidden />
        APMail
      </Link>
      <p className="px-2 text-xs font-semibold text-muted-foreground">CAIXAS DE E-MAIL</p>
      {boxes.data?.map((b) => (
        <Link
          to="/mail/$mailboxId"
          params={{ mailboxId: b.id }}
          key={b.id}
          className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
          activeProps={{ className: 'bg-secondary text-secondary-foreground' }}
          onClick={() => setOpen(false)}
        >
          <Mail className="size-4 shrink-0" aria-hidden />
          <span className="truncate" title={b.name}>
            {b.name}
          </span>
        </Link>
      ))}
      {!boxes.data?.length && (
        <p className="px-2 py-4 text-sm text-muted-foreground">Sem caixas disponíveis</p>
      )}
      <div className="mt-auto border-t pt-4">
        <p className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-muted-foreground">
          <Settings className="size-4" />
          CONFIGURAÇÕES
        </p>
        {[
          ['/settings/profile', 'Meu perfil'],
          ['/settings/preferences', 'Preferências'],
          ...(admin
            ? [
                ['/settings/users', 'Equipe e acessos'],
                ['/settings/mailboxes', 'Caixas de e-mail'],
                ['/settings/tenant', 'Empresa'],
                ['/settings/audit', 'Auditoria'],
              ]
            : []),
        ].map(([to, label]) => (
          <a
            key={to}
            href={to}
            className="flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
  return (
    <TenantContext.Provider value={me.data.current_tenant_id}>
      <TableUserContext.Provider value={me.data.user.id}>
        <div
          data-density={me.data.preferences.density}
          className="flex min-h-dvh data-[density=comfortable]:[&_td]:py-2 data-[density=compact]:[&_td]:py-1.5"
        >
          <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:block">
            {sidebar}
          </aside>
          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b bg-card px-4">
              <div className="flex min-w-0 items-center gap-2">
                <Sheet open={open} onOpenChange={setOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Abrir navegação"
                      className="lg:hidden"
                    >
                      <Menu />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="p-0">
                    <SheetTitle className="sr-only">Navegação APMail</SheetTitle>
                    {sidebar}
                  </SheetContent>
                </Sheet>
                <label htmlFor="company" className="sr-only">
                  Empresa atual
                </label>
                <select
                  id="company"
                  className="h-11 max-w-36 rounded-md sm:max-w-48 border border-input bg-card px-2 text-sm"
                  value={me.data.current_tenant_id ?? ''}
                  onChange={async (e) => {
                    await api('/me/current-tenant', {
                      method: 'PUT',
                      body: { tenant_id: e.target.value },
                    });
                    client.clear();
                    await navigate({ to: '/' });
                    location.reload();
                  }}
                >
                  {me.data.tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <NotificationBell />
                <Link
                  to="/settings/profile"
                  aria-label="Meu perfil"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center"
                >
                  <UserAvatar
                    name={me.data.user.full_name}
                    src={me.data.user.avatar_url ?? undefined}
                  />
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Sair"
                  onClick={async () => {
                    await api('/auth/logout', { method: 'POST' });
                    client.clear();
                    await navigate({ to: '/login' });
                  }}
                >
                  <LogOut />
                </Button>
              </div>
            </header>
            <main className="mx-auto max-w-screen-2xl p-4 sm:p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </TableUserContext.Provider>
    </TenantContext.Provider>
  );
}
