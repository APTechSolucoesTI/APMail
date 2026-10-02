import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { meQuery } from '@/lib/auth';
export function NavigationGroup({
  id,
  label,
  children,
  defaultOpen = true,
}: {
  id: string;
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const me = useQuery(meQuery).data;
  const controlsId = useId();
  const key = `apmail-nav:${me?.user.id}:${me?.current_tenant_id}:${id}`;
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const saved = localStorage.getItem(key);
  const open = stored[key] ?? (saved === null ? defaultOpen : saved === 'true');
  return (
    <section>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-sm font-semibold hover:bg-muted"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={() => {
          localStorage.setItem(key, String(!open));
          setStored((prev) => ({ ...prev, [key]: !open }));
        }}
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden className={'size-4 shrink-0 ' + (open ? '' : '-rotate-90')} />
      </button>
      {open && <div id={controlsId}>{children}</div>}
    </section>
  );
}
