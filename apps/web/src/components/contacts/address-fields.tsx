import { useState } from 'react';
import { type ContactInput } from '@apmail/shared';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
type Address = NonNullable<ContactInput['emails'][number]['links'][number]['address']>;
export const blankAddress: Address = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  country: 'Brasil',
};
export function AddressFields({
  value,
  onChange,
  id,
}: {
  value: Address;
  onChange: (value: Address) => void;
  id: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lookup = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<{ address: Address }>(
        '/contacts/lookup/cep/' + encodeURIComponent(value.cep),
      );
      onChange({
        ...data.address,
        number: value.number,
        complement: value.complement || data.address.complement,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível consultar o CEP.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={id + 'cep'}>CEP</Label>
          <Input
            id={id + 'cep'}
            value={value.cep}
            onChange={(e) => onChange({ ...value, cep: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void lookup();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void lookup()}>
          {busy ? 'Consultando…' : 'Consultar CEP'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} Você pode preencher manualmente.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['street', 'Logradouro'],
            ['number', 'Número'],
            ['complement', 'Complemento'],
            ['district', 'Bairro'],
            ['city', 'Cidade'],
            ['state', 'Estado'],
            ['country', 'País'],
          ] as const
        ).map(([key, label]) => (
          <div className="space-y-2" key={key}>
            <Label htmlFor={id + key}>{label}</Label>
            <Input
              id={id + key}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
