import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import type { CompanyDetail } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export function CompanyInfo({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false),
    tenant = useTenantId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null),
    content = useRef<HTMLDivElement>(null),
    suppressFocus = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    if (content.current?.contains(document.activeElement)) return;
    timer.current = setTimeout(() => setOpen(false), 180);
  };
  const q = useQuery({
    queryKey: ['company', tenant, id],
    queryFn: ({ signal }) => api<CompanyDetail>('/companies/' + id, { signal }),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 sm:size-8"
          aria-label={'Informações de ' + name}
          ref={trigger}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') enter();
          }}
          onPointerLeave={leave}
          onFocus={(e) => {
            if (!suppressFocus.current && e.currentTarget.matches(':focus-visible')) enter();
          }}
        >
          <Info aria-hidden className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        align="start"
        tabIndex={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (
            document.activeElement !== trigger.current &&
            !content.current?.contains(document.activeElement)
          )
            return;
          suppressFocus.current = true;
          trigger.current?.focus({ preventScroll: true });
          queueMicrotask(() => {
            suppressFocus.current = false;
          });
        }}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={() => clearTimeout(timer.current)}
        className="max-h-[55dvh] w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto overscroll-contain"
      >
        <h3 className="text-base font-semibold">Informações da empresa</h3>
        {q.isLoading ? (
          <LoadingState />
        ) : q.error ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          q.data && (
            <>
              <dl className="space-y-2 text-sm">
                {[
                  ['Razão social', q.data.name],
                  ['Nome fantasia', q.data.trade_name],
                  ['CNPJ', q.data.cnpj],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value || 'Não informado'}</dd>
                  </div>
                ))}
              </dl>
              <h4 className="text-sm font-semibold">Endereços</h4>
              {!q.data.addresses.length ? (
                <p className="text-sm text-muted-foreground">Nenhum endereço cadastrado.</p>
              ) : (
                q.data.addresses.map((a, i) => (
                  <address key={i} className="rounded-md border p-3 text-sm not-italic">
                    <p>
                      {[a.street, a.number, a.complement].filter(Boolean).join(', ') ||
                        'Logradouro não informado'}
                    </p>
                    <p>{[a.district, a.city, a.state].filter(Boolean).join(' · ')}</p>
                    <p>{[a.cep, a.country].filter(Boolean).join(' · ')}</p>
                  </address>
                ))
              )}
            </>
          )
        )}
      </PopoverContent>
    </Popover>
  );
}
