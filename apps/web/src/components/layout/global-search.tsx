import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Mail,
  Inbox,
  Settings,
  ListFilter,
  Tag,
  Folder,
  Send,
  MessageSquare,
  Building2,
} from 'lucide-react';
import { searchCategories, type GlobalSearchResponse, type SearchCategory } from '@apmail/shared';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';

const icons = {
  contact: Users,
  company: Building2,
  email: Mail,
  mailbox: Inbox,
  setting: Settings,
  queue: ListFilter,
  label: Tag,
  folder: Folder,
  outbox: Send,
  chat: MessageSquare,
};
export function GlobalSearch() {
  const tenant = useTenantId(),
    navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(''),
    [term, setTerm] = useState(''),
    [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  const query = useQuery({
    queryKey: ['global-search', tenant, term],
    queryFn: ({ signal }) =>
      api<GlobalSearchResponse>('/search?' + new URLSearchParams({ q: term }), { signal }),
    enabled: open && term.length >= 2,
    staleTime: 10000,
  });
  const current = value.trim() === term;
  const groups = current ? query.data?.groups.filter((group) => group.items.length) : undefined;
  return (
    <div
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      className="order-last w-full min-w-0 pb-3 md:order-none md:max-w-xl md:flex-1 md:pb-0"
    >
      <Command
        shouldFilter={false}
        className="relative h-auto overflow-visible border bg-background focus-within:ring-2 focus-within:ring-ring [&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-input-wrapper]]:border-0"
      >
        <CommandInput
          ref={input}
          aria-label="Busca global"
          aria-expanded={open}
          maxLength={200}
          placeholder="Buscar contatos, e-mails, caixas…"
          value={value}
          onValueChange={setValue}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              input.current?.blur();
            }
          }}
          className="pr-14"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-3 rounded border px-1 font-mono text-xs text-muted-foreground"
        >
          Ctrl K
        </kbd>
        <CommandList
          hidden={!open}
          aria-label="Resultados da busca global"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(65dvh,32rem)] rounded-lg border bg-popover text-popover-foreground shadow-md"
        >
          {value.trim().length < 2 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Digite pelo menos 2 caracteres para pesquisar nesta empresa.
            </p>
          ) : !current || query.isLoading ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Buscando…
            </p>
          ) : query.error ? (
            <div role="alert" className="space-y-2 p-4 text-sm">
              <p>Não foi possível pesquisar.</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : !groups?.length ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Nenhum resultado encontrado. Tente outro termo.
            </p>
          ) : (
            groups.map((group) => {
              const Icon = icons[group.category as SearchCategory];
              return (
                <CommandGroup key={group.category} heading={searchCategories[group.category]}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.category + ':' + item.id}
                      value={item.category + ':' + item.id}
                      className="min-h-11 cursor-pointer items-start gap-3 py-3"
                      onSelect={() => {
                        setOpen(false);
                        input.current?.blur();
                        void navigate({ to: item.url });
                      }}
                    >
                      <Icon aria-hidden className="mt-0.5 size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium">{item.title}</span>
                        <span className="block break-words text-xs">{item.description}</span>
                      </span>
                      <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs">
                        {searchCategories[item.category]}
                      </span>
                    </CommandItem>
                  ))}
                  {group.has_more && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      Mostrando 5 resultados. Refine a busca para encontrar os demais.
                    </p>
                  )}
                </CommandGroup>
              );
            })
          )}
        </CommandList>
      </Command>
    </div>
  );
}
