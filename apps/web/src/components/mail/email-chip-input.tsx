import { useId, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { X, Mail, Loader2 } from 'lucide-react';
import type { Address } from '@apmail/shared';
import { resolveAddress } from '@apmail/shared';
import { useContactResolution } from '@/lib/contact-resolution';
import { api } from '@/lib/api';
import { useTenantId, useUserId } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
export function EmailChipInput({
  label,
  value,
  onChange,
  mailboxId,
  compact = false,
}: {
  label: string;
  value: Address[];
  onChange: (addresses: Address[]) => void;
  mailboxId: string;
  compact?: boolean;
}) {
  const id = useId(),
    tenant = useTenantId(),
    [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const resolved = useContactResolution(value.map((a) => a.address));
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input), 350);
    return () => clearTimeout(timer);
  }, [input]);
  const q = useQuery({
    queryKey: ['address-suggestions', tenant, useUserId(), mailboxId, debounced],
    queryFn: ({ signal }) =>
      api<(Address & { nickname?: string; company_name?: string; source?: string })[]>(
        '/mailboxes/' + mailboxId + '/address-suggestions?q=' + encodeURIComponent(debounced),
        { signal },
      ),
    enabled: debounced.length >= 2,
  });
  const suggestions =
    input === debounced
      ? (q.data ?? []).filter(
          (a) => !value.some((v) => v.address.toLowerCase() === a.address.toLowerCase()),
        )
      : [];
  const expanded = open && input.trim().length >= 2;
  const choose = (address: Address) => {
    if (!value.some((v) => v.address.toLowerCase() === address.address.toLowerCase()))
      onChange([...value, address]);
    setInput('');
    setOpen(false);
    setActive(0);
    field.current?.focus();
  };
  const add = (text: string) => {
    const parsed = text
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const match = t.match(/^(.*?)\s*<([^>]+)>$/);
        return {
          name: match?.[1]?.replace(/^"|"$/g, '') ?? '',
          address: (match?.[2] ?? t).toLowerCase(),
        };
      });
    const seen = new Set(value.map((address) => address.address.toLowerCase()));
    onChange([
      ...value,
      ...parsed.filter((address) => {
        if (seen.has(address.address)) return false;
        seen.add(address.address);
        return true;
      }),
    ]);
    setInput('');
    setOpen(false);
    setActive(0);
  };
  return (
    <div
      className={
        compact ? 'relative flex min-w-0 items-start gap-3 border-b' : 'relative space-y-1'
      }
    >
      <Label
        htmlFor={id}
        className={compact ? 'w-12 shrink-0 pt-3 text-xs text-muted-foreground' : undefined}
      >
        {label}
      </Label>
      <div
        className={
          compact
            ? 'flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1 py-1 focus-within:ring-1 focus-within:ring-ring'
            : 'flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-input bg-card p-1 focus-within:ring-2 focus-within:ring-ring'
        }
      >
        {value.map((a, i) => {
          const identity = resolveAddress(a, resolved.data?.contacts ?? {});
          const valid = z.email().safeParse(a.address).success;
          return (
            <span
              key={i}
              title={identity.name + ' <' + a.address + '>'}
              className={
                valid
                  ? 'flex max-w-full items-center rounded-sm bg-secondary px-2 text-xs text-secondary-foreground'
                  : 'flex max-w-full items-center rounded-sm bg-destructive/10 px-2 text-xs text-destructive'
              }
            >
              <span className="break-all">
                {identity.contact ? identity.name + ' — ' + a.address : a.address}
                {!valid ? ' (inválido)' : ''}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={'Remover ' + a.address}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </span>
          );
        })}
        <input
          ref={field}
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? id + '-suggestions' : undefined}
          aria-activedescendant={
            expanded && suggestions[active] ? id + '-option-' + active : undefined
          }
          className="min-h-8 min-w-24 flex-1 bg-transparent px-2 text-sm outline-none"
          value={input}
          onChange={(e) => {
            if (/[,;]/.test(e.target.value)) add(e.target.value);
            else {
              setInput(e.target.value);
              setOpen(true);
              setActive(0);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (input.trim()) add(input);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && expanded) {
              e.preventDefault();
              setOpen(false);
              return;
            }
            if (['ArrowDown', 'ArrowUp'].includes(e.key) && suggestions.length) {
              e.preventDefault();
              setOpen(true);
              setActive(
                (index) =>
                  (index + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                  suggestions.length,
              );
              return;
            }
            if (
              expanded &&
              ['Enter', 'Tab'].includes(e.key) &&
              suggestions[active] &&
              !z.email().safeParse(input.trim()).success
            ) {
              if (e.key === 'Enter') e.preventDefault();
              choose(suggestions[active]!);
              return;
            }
            if (['Enter', 'Tab', ',', ';'].includes(e.key) && input.trim()) {
              if (e.key !== 'Tab') e.preventDefault();
              add(input);
            }
            if (e.key === 'Backspace' && !input) onChange(value.slice(0, -1));
          }}
          onPaste={(e) => {
            if (/[,;\n]/.test(e.clipboardData.getData('text'))) {
              e.preventDefault();
              add(e.clipboardData.getData('text'));
            }
          }}
          aria-describedby={id + '-help'}
        />
      </div>
      {expanded && (
        <div
          className={
            'absolute inset-x-0 z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md ' +
            (compact ? 'top-full' : 'top-[calc(100%-1.25rem)]')
          }
        >
          <div className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
            Endereços sugeridos
          </div>
          <div
            id={id + '-suggestions'}
            role="listbox"
            aria-label={'Sugestões para ' + label}
            className="max-h-64 overflow-y-auto"
          >
            {suggestions.map((address, index) => (
              <button
                key={address.address}
                id={id + '-option-' + index}
                type="button"
                role="option"
                aria-selected={active === index}
                tabIndex={-1}
                className={
                  'flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent ' +
                  (index === active ? 'bg-accent text-accent-foreground' : '')
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(address)}
                onMouseMove={() => setActive(index)}
              >
                <Mail
                  className={
                    'size-4 shrink-0 ' +
                    (index === active ? 'text-accent-foreground' : 'text-muted-foreground')
                  }
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-medium"
                    title={address.name || address.address}
                  >
                    {address.name || address.address}
                  </span>
                  <span
                    className={
                      'block break-all text-xs ' +
                      (index === active ? 'text-accent-foreground' : 'text-muted-foreground')
                    }
                  >
                    {address.address}
                  </span>
                  {!!address.company_name && (
                    <span
                      className={
                        'block truncate text-xs ' +
                        (index === active ? 'text-accent-foreground' : 'text-muted-foreground')
                      }
                    >
                      {address.company_name}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {!suggestions.length && (
            <p
              role="status"
              className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"
            >
              {q.isFetching || input !== debounced ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Buscando endereços…
                </>
              ) : q.error ? (
                'Não foi possível buscar. Você pode informar o e-mail completo.'
              ) : (
                'Nenhum endereço encontrado. Informe o e-mail completo.'
              )}
            </p>
          )}
        </div>
      )}
      <p id={id + '-help'} className={compact ? 'sr-only' : 'text-xs text-muted-foreground'}>
        Separe endereços por vírgula ou ponto e vírgula.
      </p>
    </div>
  );
}
