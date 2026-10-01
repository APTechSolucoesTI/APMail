import { useId, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { X } from 'lucide-react';
import type { Address } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
export function EmailChipInput({
  label,
  value,
  onChange,
  mailboxId,
}: {
  label: string;
  value: Address[];
  onChange: (addresses: Address[]) => void;
  mailboxId: string;
}) {
  const id = useId(),
    tenant = useTenantId(),
    [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input), 350);
    return () => clearTimeout(timer);
  }, [input]);
  const q = useQuery({
    queryKey: ['address-suggestions', tenant, mailboxId, debounced],
    queryFn: () =>
      api<Address[]>(
        '/mailboxes/' + mailboxId + '/address-suggestions?q=' + encodeURIComponent(debounced),
      ),
    enabled: debounced.length >= 2,
  });
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
    onChange([
      ...value,
      ...parsed.filter((p) => !value.some((v) => v.address.toLowerCase() === p.address)),
    ]);
    setInput('');
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-input bg-card p-1 focus-within:ring-2 focus-within:ring-ring">
        {value.map((a, i) => {
          const valid = z.email().safeParse(a.address).success;
          return (
            <span
              key={i}
              title={a.name ? a.name + ' <' + a.address + '>' : a.address}
              className={
                valid
                  ? 'flex max-w-full items-center rounded-sm bg-secondary px-2 text-xs text-secondary-foreground'
                  : 'flex max-w-full items-center rounded-sm bg-destructive/10 px-2 text-xs text-destructive'
              }
            >
              <span className="break-all">
                {a.address}
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
          id={id}
          list={id + '-suggestions'}
          className="min-h-10 min-w-32 flex-1 bg-transparent px-2 text-sm outline-none"
          value={input}
          onChange={(e) => {
            if (/[,;]/.test(e.target.value)) add(e.target.value);
            else setInput(e.target.value);
          }}
          onBlur={() => {
            if (input.trim()) add(input);
          }}
          onKeyDown={(e) => {
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
        <datalist id={id + '-suggestions'}>
          {q.data?.map((a) => (
            <option key={a.address} value={a.address}>
              {a.name}
            </option>
          ))}
        </datalist>
      </div>
      <p id={id + '-help'} className="text-xs text-muted-foreground">
        Separe endereços por vírgula ou ponto e vírgula.
      </p>
    </div>
  );
}
