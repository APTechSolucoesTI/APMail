import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/data/data-state';
import { format } from 'date-fns';
type Notification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};
export function NotificationBell() {
  const client = useQueryClient();
  const count = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
  });
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api<Notification[]>('/notifications'),
  });
  const read = async (id?: string) => {
    await api(id ? '/notifications/' + id + '/read' : '/notifications/read-all', {
      method: 'POST',
    });
    await client.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notificações${count.data?.count ? ', ' + count.data.count + ' não lidas' : ''}`}
          className="relative"
        >
          <Bell aria-hidden />
          {!!count.data?.count && (
            <span className="absolute top-1 right-1 rounded-full bg-primary px-1 text-xs text-primary-foreground">
              {count.data.count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Notificações</h2>
          <Button variant="ghost" size="sm" onClick={() => void read()}>
            Marcar todas
          </Button>
        </div>
        {list.error ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : !list.data?.length ? (
          <p className="py-4 text-sm text-muted-foreground" role="status">
            Você está em dia.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {list.data.map((n) => (
              <li key={n.id} className="rounded-md border p-3">
                <button
                  className="block w-full text-left text-sm font-semibold"
                  onClick={() => void read(n.id)}
                >
                  {n.title}
                  {!n.read_at && <span className="ml-2 text-xs text-primary">Nova</span>}
                </button>
                <p className="mt-1 text-xs text-muted-foreground">{n.body}</p>
                <time className="text-xs text-muted-foreground">
                  {format(new Date(n.created_at), 'dd/MM HH:mm')}
                </time>
                {n.link?.startsWith('/') && !n.link.startsWith('//') && (
                  <a
                    className="mt-2 block text-sm text-primary underline"
                    href={n.link}
                    onClick={() => void read(n.id)}
                  >
                    Abrir
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
