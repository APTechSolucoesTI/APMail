import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { domainNameSchema, type DomainOption } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
export function MailboxAddressFields({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    text = String(value ?? ''),
    [part = '', domain = ''] = text.split('@');
  const q = useQuery({
    queryKey: ['mailbox-domains', tenant],
    queryFn: () => api<DomainOption[]>('/mailbox-domains'),
  });
  const [adding, setAdding] = useState(false),
    [newDomain, setNewDomain] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const name = domainNameSchema.parse(newDomain);
      const option = await api<DomainOption>('/mailbox-domains', {
        method: 'POST',
        body: { domain: name },
      });
      await client.invalidateQueries({ queryKey: ['mailbox-domains'] });
      onChange(part + '@' + option.domain);
      setAdding(false);
      setNewDomain('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível cadastrar o domínio.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-1">
          <Label htmlFor="mailbox-local-part">Parte inicial do e-mail</Label>
          <Input
            id="mailbox-local-part"
            value={part}
            autoCapitalize="none"
            onChange={(e) => onChange(e.target.value + (domain ? '@' + domain : ''))}
          />
        </div>
        <span className="hidden self-end pb-2 text-muted-foreground sm:block">@</span>
        <div className="space-y-1">
          <Label htmlFor="mailbox-domain">Domínio</Label>
          <select
            id="mailbox-domain"
            value={domain}
            onChange={(e) => onChange(part + '@' + e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="">Selecione o domínio</option>
            {domain && !q.data?.some((d) => d.domain === domain) && (
              <option value={domain}>{domain}</option>
            )}
            {q.data?.map((d) => (
              <option key={d.id} value={d.domain}>
                {d.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {q.isError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os domínios.{' '}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Tentar novamente
          </button>
        </p>
      )}
      {domain && part && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Endereço:{' '}
          <span className="font-medium text-foreground">
            {part}@{domain}
          </span>
        </p>
      )}
      <Button
        variant="link"
        type="button"
        className="h-auto p-0 text-xs"
        onClick={() => setAdding(!adding)}
      >
        Adicionar domínio
      </Button>
      {adding && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <Label htmlFor="inline-domain">Novo domínio</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="inline-domain"
              className="min-w-0 flex-1"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="empresa.com.br"
            />
            <Button type="button" disabled={busy} onClick={() => void create()}>
              {busy ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A conta de e-mail deve existir no seu provedor.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
