import { AdminNavigation } from '@/components/admin/admin-navigation';
import { ProfileMenu } from '@/components/admin/profile-menu';
import { DomainMailboxNavigation } from '@/components/mail/domain-mailbox-navigation';
import { hasAccess, screenPermission, type AccessPermission } from '@apmail/shared';
import { isTenantAdmin } from '@apmail/shared';
import { canDelegate } from '@apmail/shared';
import { NavigationGroup } from './navigation-group';
import { useEffect, useState, useRef } from 'react';
import { Link, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { SocketContext } from '@/hooks/use-socket-room';
import { SummaryNavigation } from '@/components/mail/summary-navigation';
import { ChatNavigation } from '@/components/chat/chat-navigation';
import { useChatRealtime } from '@/hooks/use-chat';
import {
  Mail,
  Menu,
  LogOut,
  LayoutDashboard,
  Building2,
  ContactRound,
  Settings,
  UserRound,
  SlidersHorizontal,
  Signature,
  Tags,
  ListFilter,
  UsersRound,
  ClipboardList,
  CalendarDays,
  BellRing,
  Plug,
} from 'lucide-react';
import { api } from '@/lib/api';
import { meQuery, TenantContext, type Mailbox, type Me } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NotificationBell } from './notification-bell';
import { KeyboardHelp } from './keyboard-help';
import { GlobalSearch } from './global-search';
import { useTheme } from './theme-provider';
import { TableUserContext } from '@/hooks/use-table-preferences';
import { BackgroundArchiveTransfers } from '@/components/settings/background-archive-transfers';
import { stopArchiveTransfersForUser } from '@/lib/mail-archive-transfers';
import { NavigationLayout } from './navigation-layout';
import { PostSendContacts } from '@/components/contacts/post-send-contacts';
import { ReminderCenter } from '@/components/calendar/reminder-center';
const settingsIcons: Record<string, typeof Mail> = {
  '/settings/profile': UserRound,
  '/settings/preferences': SlidersHorizontal,
  '/settings/integrations': Plug,
  '/settings/signatures': Signature,
  '/settings/labels': Tags,
  '/settings/rules': ListFilter,
  '/settings/users': UsersRound,
  '/settings/mailboxes': Mail,
  '/settings/tenant': Building2,
  '/settings/audit': ClipboardList,
};
export function AppShell() {
  const me = useQuery({ ...meQuery, refetchInterval: 30000, refetchIntervalInBackground: true });
  const transferUser = me.data?.user.id;
  useEffect(
    () => () => {
      if (transferUser) stopArchiveTransfersForUser(transferUser);
    },
    [transferUser],
  );
  const client = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const mailView = pathname.startsWith('/mail/');
  const boxes = useQuery({
    queryKey: ['mailboxes', me.data?.current_tenant_id],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
    enabled: hasAccess(
      me.data?.tenants.find((t) => t.id === me.data?.current_tenant_id),
      'mail',
    ),
  });
  const [open, setOpen] = useState(false);
  const loggingOut = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(
    () => localStorage.getItem('apmail-sidebar') !== 'hidden',
  );
  const [socket] = useState(() => io({ withCredentials: true, autoConnect: false }));
  useChatRealtime(socket, me.data?.current_tenant_id, me.data?.user.id);
  const { setTheme } = useTheme();
  const theme = me.data?.preferences.theme;
  useEffect(() => {
    if (theme) setTheme(theme);
  }, [theme, setTheme]);
  useEffect(() => {
    socket.connect();
    socket.on('access:schedule-blocked', () =>
      window.location.replace('/login?reason=outside_schedule'),
    );
    socket.on('connect', () => {
      void client.invalidateQueries({ queryKey: ['mailboxes'] });
      void client.invalidateQueries({ queryKey: ['mailbox'] });
      // A reconnect may happen while a route is checking the session. Keep its
      // in-flight check alive so navigation cannot unmount an active transfer.
      void client.invalidateQueries({ queryKey: ['me'] }, { cancelRefetch: false });
      void client.invalidateQueries({ queryKey: ['notifications'] });
      for (const key of [
        'threads',
        'thread',
        'folders',
        'queue-counts',
        'outbox',
        'labels',
        'rules',
        'thread-notes',
        'thread-history',
        'dashboard',
        'global-search',
        'contacts',
        'contact',
        'contact-history',
        'companies',
        'company',
        'company-options',
        'chat-conversations',
        'chat-messages',
        'chat-presence',
        'calendar',
        'meet-reports',
        'google-integration',
      ])
        void client.invalidateQueries({ queryKey: [key] });
    });
    socket.on('access:changed', () => {
      void client.invalidateQueries({}, { cancelRefetch: false }).then(() => {
        if (!socket.connected && !loggingOut.current) socket.connect();
      });
    });
    socket.on('tenant:settings-changed', () => {
      for (const key of ['me', 'tenant', 'admin-overview', 'dashboard', 'queue-counts'])
        void client.invalidateQueries({ queryKey: [key] });
    });
    socket.on('mailboxes:changed', () => {
      for (const key of [
        'labels',
        'threads',
        'thread',
        'folders',
        'queue-counts',
        'thread-notes',
        'thread-history',
        'outbox',
        'shared-thread-access',
        'address-suggestions',
        'contact-resolution',
        'threads',
        'thread',
        'dashboard',
        'global-search',
      ])
        void client.resetQueries({ queryKey: [key] });
      void client.invalidateQueries({ queryKey: ['mailboxes'] });
      void client.invalidateQueries({ queryKey: ['mailbox'] });
      void client.invalidateQueries({ queryKey: ['me'] }, { cancelRefetch: false });
    });
    socket.on(
      'notification:new',
      ({
        notification,
      }: {
        notification: {
          id: string;
          type: string;
          title: string;
          body: string;
          link: string | null;
        };
      }) => {
        void client.invalidateQueries({ queryKey: ['notifications'] });
        const prefs = client.getQueryData<Me>(['me'])?.preferences;
        if (
          (notification.type === 'mention' && prefs?.notify_mentions === false) ||
          (notification.type === 'assignment' && prefs?.notify_assignments === false) ||
          (notification.type === 'chat_message' && prefs?.notify_chat === false)
        )
          return;
        if (notification.type === 'reminder')
          void client.invalidateQueries({ queryKey: ['calendar'] });
        else toast.info(notification.title, { description: notification.body });
        if (
          prefs?.desktop_notifications &&
          document.visibilityState !== 'visible' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          const notice = new Notification(notification.title, {
            body: notification.body,
            tag: notification.id,
          });
          notice.onclick = () => {
            window.focus();
            if (notification.link?.startsWith('/') && !notification.link.startsWith('//'))
              void navigate({ to: notification.link });
            notice.close();
          };
        }
      },
    );
    socket.on('disconnect', () => {
      if (!loggingOut.current)
        void client.invalidateQueries({ queryKey: ['me'] }, { cancelRefetch: false });
    });
    const invalidate = (...keys: string[]) => {
      for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
    };
    socket.on('threads:changed', () =>
      invalidate('labels', 'threads', 'thread', 'thread-history', 'global-search'),
    );
    socket.on(
      'thread:notes-changed',
      ({ thread_id }: { thread_id: string }) =>
        void client.invalidateQueries({
          queryKey: ['thread-notes', me.data?.current_tenant_id, thread_id],
        }),
    );
    socket.on('queue-counts:changed', () => invalidate('folders', 'queue-counts', 'dashboard'));
    socket.on(
      'thread:messages-changed',
      ({ thread_id }: { thread_id: string }) =>
        void client.invalidateQueries({
          queryKey: ['thread', me.data?.current_tenant_id, thread_id],
        }),
    );
    socket.on('folders:changed', () => invalidate('folders'));
    socket.on('attachments:changed', () =>
      invalidate(
        'attachment-security',
        'thread',
        'antivirus-files',
        'antivirus-overview',
        'antivirus-history',
      ),
    );
    socket.on('calendar:changed', () =>
      invalidate('calendar', 'meet-reports', 'threads', 'thread'),
    );
    socket.on('google-meet:changed', () => invalidate('meet-reports', 'google-integration'));
    socket.on('labels:changed', () => invalidate('labels', 'threads', 'thread', 'global-search'));
    socket.on('directory:changed', () =>
      invalidate(
        'contacts',
        'contact',
        'companies',
        'company',
        'company-options',
        'global-search',
        'address-suggestions',
      ),
    );
    socket.on('mailbox:status', () => invalidate('mailboxes', 'mailbox'));
    socket.on('outbox:changed', () =>
      invalidate(
        'outbox',
        'outbox-detail',
        'recurring-schedules',
        'thread',
        'threads',
        'queue-counts',
      ),
    );
    socket.on('notifications:changed', () => invalidate('notifications'));
    socket.on('mailbox:storage', () => invalidate('storage-quota'));
    socket.on('mail:archive-progress', () =>
      invalidate('mail-archives', 'pst-exports', 'storage-quota'),
    );
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [client, socket, me.data?.current_tenant_id, navigate]);
  useEffect(() => {
    if (me.error && 'status' in me.error && me.error.status === 401)
      void navigate({ to: '/login' });
    else if (me.data && !me.data.current_tenant_id)
      void navigate({ to: me.data.platform_admin ? '/superadmin' : '/onboarding' });
  }, [me.error, me.data, navigate]);
  useEffect(() => {
    const tenant = me.data?.tenants.find((t) => t.id === me.data?.current_tenant_id);
    const permission = screenPermission(pathname);
    if (tenant?.access_permissions != null && permission && !hasAccess(tenant, permission))
      void navigate({ to: '/' });
  }, [me.data, pathname, navigate]);
  if (!me.data)
    return (
      <div role="status" className="p-6">
        Carregando sua equipe…
      </div>
    );
  const tenant = me.data.tenants.find((t) => t.id === me.data!.current_tenant_id);
  const admin = isTenantAdmin(tenant?.role);
  const allowed = (permission: AccessPermission) => hasAccess(tenant, permission);
  const sidebar = pathname.startsWith('/admin') ? (
    <AdminNavigation onNavigate={() => setOpen(false)} />
  ) : (
    <ScrollArea
      type="hover"
      className="h-full min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-scrollbar]]:w-2 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/80 [&_[data-slot=scroll-area-thumb]:hover]:bg-muted-foreground"
    >
      <nav
        aria-label="Navegação principal"
        className="flex min-h-full w-full min-w-0 flex-col gap-2 p-4"
      >
        <Link
          to="/"
          className="mb-3 flex items-center gap-2 text-xl font-semibold text-primary"
          onClick={() => setOpen(false)}
        >
          <Mail aria-hidden />
          APMail
        </Link>
        <NavigationGroup
          id="productivity"
          label="Produtividade"
          visible={
            allowed('reports') ||
            allowed('calendar') ||
            allowed('schedules') ||
            allowed('reminders')
          }
        >
          {tenant && allowed('reports') && (
            <Link
              to="/dashboard"
              onClick={() => setOpen(false)}
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
              className="flex min-h-11 sm:min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <LayoutDashboard aria-hidden className="size-4" />
              Dashboard
            </Link>
          )}
          {allowed('calendar') && (
            <Link
              to="/calendar"
              onClick={() => setOpen(false)}
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
              className="flex min-h-11 sm:min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
            >
              <CalendarDays aria-hidden className="size-4" />
              Calendário
            </Link>
          )}
          {allowed('schedules') && (
            <Link
              to="/scheduled"
              onClick={() => setOpen(false)}
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
              className="flex min-h-11 sm:min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
            >
              <Mail aria-hidden className="size-4" />
              Envios e agendamentos
            </Link>
          )}
          {allowed('reminders') && (
            <Link
              to="/reminders"
              onClick={() => setOpen(false)}
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
              className="flex min-h-11 sm:min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
            >
              <BellRing aria-hidden className="size-4" />
              Lembretes e tarefas
            </Link>
          )}
        </NavigationGroup>
        <NavigationGroup
          id="communication"
          label="Comunicação"
          visible={allowed('mail') || allowed('contacts') || allowed('chat')}
        >
          <NavigationGroup
            id="mailboxes"
            visible={allowed('mail')}
            indentContent
            label="Caixas de e-mail"
            icon={<Mail className="size-4" />}
          >
            {me.data?.preferences.mail_summary_enabled && (
              <SummaryNavigation onNavigate={() => setOpen(false)} />
            )}
            <DomainMailboxNavigation boxes={boxes.data ?? []} onNavigate={() => setOpen(false)} />
            {!boxes.data?.length && (
              <p className="px-2 py-3 text-xs text-muted-foreground">Sem caixas disponíveis</p>
            )}
          </NavigationGroup>
          {allowed('contacts') && (
            <Link
              to="/contacts"
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
              className="flex min-h-11 sm:min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <ContactRound aria-hidden className="size-4 shrink-0" />
              Contatos
            </Link>
          )}
          {allowed('chat') && <ChatNavigation onNavigate={() => setOpen(false)} />}
        </NavigationGroup>
        <div className="mt-auto border-t pt-4">
          <NavigationGroup
            id="settings"
            defaultOpen={pathname.startsWith('/settings')}
            label="Configurações"
            icon={<Settings aria-hidden className="size-4 shrink-0" />}
          >
            {[
              ['/settings/profile', 'Meu perfil'],
              ['/settings/preferences', 'Preferências'],
              ['/settings/integrations', 'Integrações'],
              ['/settings/signatures', 'Assinaturas'],
              ['/settings/labels', 'Etiquetas'],
              ['/settings/rules', 'Regras'],
              ...(!admin &&
              (canDelegate(tenant?.role ?? null, tenant?.capabilities, 'members') ||
                (tenant?.access_permissions != null &&
                  (allowed('users.view') || allowed('profiles.manage'))))
                ? [
                    [
                      allowed('users.view') ? '/settings/users' : '/settings/access-profiles',
                      'Equipe e acesso',
                    ],
                  ]
                : []),
              ...(!admin &&
              (canDelegate(tenant?.role ?? null, tenant?.capabilities, 'audit') ||
                (tenant?.access_permissions != null && allowed('audit.view')))
                ? [['/settings/audit', 'Auditoria']]
                : []),
              ...(admin
                ? [
                    ['/settings/users', 'Equipe e acesso'],
                    ['/settings/mailboxes', 'Caixas de e-mail'],
                    ['/settings/tenant', 'Empresa'],
                    ['/settings/audit', 'Auditoria'],
                  ]
                : []),
            ]
              .filter(([to]) =>
                [
                  '/settings/preferences',
                  '/settings/signatures',
                  '/settings/labels',
                  '/settings/rules',
                ].includes(to!),
              )
              .filter(([to]) => {
                const permission = screenPermission(to!);
                return tenant?.access_permissions == null || !permission || allowed(permission);
              })
              .map(([to, label]) => {
                const Icon = settingsIcons[to!] ?? Settings;
                return (
                  <Link
                    key={to}
                    to={to}
                    activeProps={{ className: 'bg-accent text-accent-foreground' }}
                    className="flex min-h-11 sm:min-h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
                    onClick={() => setOpen(false)}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
          </NavigationGroup>
          {me.data.platform_admin && (
            <Link
              to="/superadmin"
              className="flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-muted"
            >
              Gestão da plataforma
            </Link>
          )}
        </div>
      </nav>
    </ScrollArea>
  );
  return (
    <SocketContext.Provider value={socket}>
      <TenantContext.Provider value={me.data.current_tenant_id}>
        <TableUserContext.Provider value={me.data.user.id}>
          <div
            data-density="compact"
            className="h-dvh overflow-hidden data-[density=comfortable]:[&_td]:py-2 data-[density=compact]:[&_td]:py-1.5"
          >
            <NavigationLayout userId={me.data.user.id} visible={sidebarVisible} sidebar={sidebar}>
              <div className="flex h-full min-h-0 min-w-0 flex-col">
                <header className="z-20 flex min-h-16 sm:min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      className="hidden lg:inline-flex"
                      variant="ghost"
                      size="icon"
                      aria-label={sidebarVisible ? 'Ocultar navegação' : 'Exibir navegação'}
                      aria-expanded={sidebarVisible}
                      onClick={() => {
                        setSidebarVisible(!sidebarVisible);
                        localStorage.setItem(
                          'apmail-sidebar',
                          sidebarVisible ? 'hidden' : 'visible',
                        );
                      }}
                    >
                      <Menu />
                    </Button>
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
                      <SheetContent side="left" className="w-[90vw] max-w-sm p-0 sm:max-w-sm">
                        <SheetTitle className="sr-only">Navegação APMail</SheetTitle>
                        {sidebar}
                      </SheetContent>
                    </Sheet>
                    <label htmlFor="company" className="sr-only">
                      Empresa atual
                    </label>
                    <select
                      id="company"
                      className="h-11 sm:h-8 max-w-28 rounded-md sm:max-w-48 border border-input bg-card px-2 text-sm"
                      value={me.data.current_tenant_id ?? ''}
                      onChange={async (e) => {
                        stopArchiveTransfersForUser(me.data!.user.id);
                        await api('/me/current-tenant', {
                          method: 'PUT',
                          body: { tenant_id: e.target.value },
                        });
                        await client.cancelQueries();
                        client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
                        await client.invalidateQueries({ queryKey: ['me'] });
                        await navigate({ to: '/' });
                      }}
                    >
                      {me.data.tenants.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {allowed('mail') && <GlobalSearch key={me.data.current_tenant_id} />}
                  <div className="flex items-center gap-0 sm:gap-2">
                    <KeyboardHelp mailboxes={boxes.data ?? []} />
                    <NotificationBell />
                    <ProfileMenu />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Sair"
                      disabled={signingOut}
                      onClick={async () => {
                        if (loggingOut.current) return;
                        loggingOut.current = true;
                        setSigningOut(true);
                        stopArchiveTransfersForUser(me.data!.user.id);
                        socket.disconnect();
                        try {
                          await client.cancelQueries();
                          await api('/auth/logout', { method: 'POST' });
                          await navigate({ to: '/login' });
                          client.clear();
                        } catch (error) {
                          loggingOut.current = false;
                          setSigningOut(false);
                          socket.connect();
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : 'Não foi possível sair. Tente novamente.',
                          );
                        }
                      }}
                    >
                      <LogOut />
                    </Button>
                  </div>
                </header>
                <main
                  className={
                    'relative mx-auto flex min-h-0 w-full max-w-screen-2xl flex-1 flex-col p-4 sm:p-6 ' +
                    (mailView ? 'overflow-hidden' : 'overflow-y-auto')
                  }
                >
                  <BackgroundArchiveTransfers
                    userId={me.data.user.id}
                    tenantId={me.data.current_tenant_id}
                  />
                  <Outlet />
                  {!signingOut && allowed('mail.send') && allowed('contacts') && (
                    <PostSendContacts />
                  )}
                  {!signingOut && allowed('reminders') && (
                    <ReminderCenter key={me.data.current_tenant_id} />
                  )}
                </main>
              </div>
            </NavigationLayout>
          </div>
        </TableUserContext.Provider>
      </TenantContext.Provider>
    </SocketContext.Provider>
  );
}
