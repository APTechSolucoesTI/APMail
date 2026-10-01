import type { LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { Mailbox } from '@/lib/auth';
import type { QueueStatus } from '@apmail/shared';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
export function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  danger,
  queue,
  boxes,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  danger?: boolean;
  queue?: Exclude<QueueStatus, 'none'> | 'overdue';
  boxes: Mailbox[];
}) {
  const className = cn(
    'block w-full rounded-lg border bg-card p-4 text-left shadow-card',
    danger && 'border-danger/30 bg-danger-bg text-danger-fg',
    queue &&
      'cursor-pointer hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  const content = (
    <>
      <span
        className={cn(
          'flex items-center justify-between gap-2 text-xs font-semibold',
          danger ? 'text-danger-fg' : 'text-muted-foreground',
        )}
      >
        <span>{label}</span>
        <Icon className="size-4 shrink-0" aria-hidden />
      </span>
      <span className="mt-2 block text-3xl font-bold leading-9 tracking-tight tabular-nums">
        {value}
      </span>
      <span
        className={cn(
          'mt-1 block min-h-4 text-xs',
          danger ? 'text-danger-fg' : 'text-muted-foreground',
        )}
      >
        {detail ?? 'Estado atual'}
      </span>
    </>
  );
  if (!queue || !boxes.length) return <div className={className}>{content}</div>;
  if (boxes.length === 1)
    return (
      <Link
        className={className}
        to="/mail/$mailboxId"
        params={{ mailboxId: boxes[0]!.id }}
        search={{ view: 'queue', queue }}
        aria-label={`${label}: ${value}. Abrir fila`}
      >
        {content}
      </Link>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={className}
          aria-label={`${label}: ${value}. Escolher caixa para abrir fila`}
        >
          {content}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <p className="mb-2 text-sm font-semibold">Abrir {label.toLocaleLowerCase('pt-BR')}</p>
        <div className="space-y-1">
          {boxes.map((box) => (
            <Link
              key={box.id}
              to="/mail/$mailboxId"
              params={{ mailboxId: box.id }}
              search={{ view: 'queue', queue }}
              className="block rounded-md px-3 py-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {box.name}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
