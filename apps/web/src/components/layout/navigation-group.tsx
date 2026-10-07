import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { meQuery } from '@/lib/auth';
export function NavigationGroup({
  id,
  label,
  children,
  defaultOpen = true,
  icon,
}: {
  id: string;
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
}) {
  const me = useQuery(meQuery).data;
  const controlsId = useId();
  const key = `apmail-nav:${me?.user.id}:${me?.current_tenant_id}:${id}`;
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const saved = localStorage.getItem(key);
  const open = stored[key] ?? (saved === null ? defaultOpen : saved === 'true');
  return (
    <section className="min-w-0">
      <button
        type="button"
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={() => {
          localStorage.setItem(key, String(!open));
          setStored((prev) => ({ ...prev, [key]: !open }));
        }}
      >
        <span className="flex min-w-0 items-center gap-2" title={label}>
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown aria-hidden className={'size-4 shrink-0 ' + (open ? '' : '-rotate-90')} />
      </button>
      {open && (
        <div id={controlsId} className="min-w-0">
          {children}
        </div>
      )}
    </section>
  );
}
