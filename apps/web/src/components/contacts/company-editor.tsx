import { useState } from 'react';
import { z } from 'zod';
import { useForm, useWatch } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  companySchema,
  type CompanyDetail,
  type CompanyInput,
  type ListResult,
} from '@apmail/shared';
import { useTenantId } from '@/lib/auth';
import { api } from '@/lib/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { DirectoryHeader, useDirectorySearch } from './directory-fields';
import { AddressFields, blankAddress } from './address-fields';
import { toast } from 'sonner';
export function CompanyEditorDialog({
  id,
  cnpj = '',
  onClose,
  onSaved,
}: {
  id?: string;
  cnpj?: string;
  onClose: () => void;
  onSaved?: (company: CompanyDetail) => void;
}) {
  const [editing, setEditing] = useState(id),
    tenant = useTenantId();
  const q = useQuery({
    queryKey: ['company', tenant, editing],
    queryFn: () => api<CompanyDetail>('/companies/' + editing),
    enabled: !!editing,
  });
  const initialLookup = useQuery({
    queryKey: ['company-cnpj-lookup', tenant, cnpj],
    queryFn: () =>
      api<{
        company: Pick<CompanyInput, 'name' | 'trade_name' | 'cnpj'>;
        address: CompanyInput['addresses'][number];
      }>('/contacts/lookup/cnpj/' + encodeURIComponent(cnpj)),
    enabled: !editing && !!cnpj,
    retry: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DirectoryHeader
          title={editing ? 'Editar empresa' : 'Nova empresa'}
          description="Cadastre os dados da empresa e seus endereços. Campos com * são obrigatórios."
        />
        {(editing && q.isLoading) || (!editing && cnpj && initialLookup.isLoading) ? (
          <LoadingState />
        ) : editing && q.error ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          <CompanyForm
            key={editing ?? 'new'}
            id={editing}
            cnpj={cnpj}
            initial={
              q.data ??
              (initialLookup.data
                ? {
                    ...initialLookup.data.company,
                    addresses: [initialLookup.data.address],
                  }
                : {
                    name: '',
                    trade_name: '',
                    cnpj,
                    addresses: [],
                  })
            }
            onExisting={setEditing}
            initialError={initialLookup.error instanceof Error ? initialLookup.error.message : ''}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function CompanyForm({
  id,
  cnpj,
  initial,
  onExisting,
  onClose,
  onSaved,
  initialError,
}: {
  id?: string;
  cnpj: string;
  initial: CompanyInput;
  onExisting: (id: string) => void;
  onClose: () => void;
  onSaved?: (company: CompanyDetail) => void;
  initialError: string;
}) {
  const form = useForm<CompanyInput>({ defaultValues: initial }),
    values = useWatch({ control: form.control, compute: () => form.getValues() }),
    tenant = useTenantId(),
    client = useQueryClient();
  const [search, setSearch] = useState(cnpj),
    term = useDirectorySearch(search),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const results = useQuery({
    queryKey: ['company-options', tenant, term, 10],
    queryFn: ({ signal }) =>
      api<ListResult<CompanyDetail>>(
        '/companies?' + new URLSearchParams({ search: term, pageSize: '10' }),
        { signal },
      ),
    enabled: term.length >= 2,
  });
  const lookup = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<{
        company: { name: string; trade_name: string; cnpj: string };
        address: CompanyInput['addresses'][number];
      }>('/contacts/lookup/cnpj/' + encodeURIComponent(value));
      form.setValue('name', data.company.name);
      form.setValue('trade_name', data.company.trade_name);
      form.setValue('cnpj', data.company.cnpj);
      form.setValue('addresses', [data.address, ...form.getValues('addresses').slice(1)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível consultar o CNPJ.');
    } finally {
      setBusy(false);
    }
  };
  const enterSearch = async () => {
    let found: CompanyDetail | undefined;
    try {
      found = (
        await api<ListResult<CompanyDetail>>(
          '/companies?' + new URLSearchParams({ search: search.trim(), pageSize: '10' }),
        )
      ).items[0];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível buscar empresas.');
      return;
    }
    if (found) {
      onExisting(found.id);
      setSearch('');
    } else if (/^[A-Z\d]{12}\d{2}$/.test(search.replace(/[.\-/\s]/g, '').toUpperCase()))
      await lookup(search);
  };
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={form.handleSubmit(async (raw) => {
        setError('');
        setFieldErrors({});
        try {
          const body = companySchema.parse(raw);
          const saved = await api<{ id: string }>(id ? '/companies/' + id : '/companies', {
            method: id ? 'PUT' : 'POST',
            body,
          });
          await client.invalidateQueries({
            predicate: (q) =>
              String(q.queryKey[0]).startsWith('compan') ||
              String(q.queryKey[0]).startsWith('contact') ||
              q.queryKey[0] === 'global-search',
          });
          if (onSaved) onSaved(await api<CompanyDetail>('/companies/' + saved.id));
          toast.success('Empresa salva.');
          onClose();
        } catch (e) {
          if (e instanceof z.ZodError) {
            setFieldErrors(
              Object.fromEntries(e.issues.map((issue) => [String(issue.path[0]), issue.message])),
            );
            if (e.issues.some((issue) => issue.path[0] === 'name')) form.setFocus('name');
          }
          setError(
            e instanceof z.ZodError
              ? e.issues.map((issue) => issue.message).join(' ')
              : e instanceof Error
                ? e.message
                : 'Não foi possível salvar.',
          );
        }
      })}
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        <div className="space-y-2">
          <Label htmlFor="company-search">Pesquisar por CNPJ, razão social ou nome fantasia</Label>
          <Input
            id="company-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void enterSearch();
              }
            }}
          />
          {term.length >= 2 &&
            results.data?.items.map((row) => (
              <Button
                key={row.id}
                type="button"
                variant="ghost"
                className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                onClick={() => onExisting(row.id)}
              >
                {row.name}
                {row.trade_name ? ' · ' + row.trade_name : ''}
                {row.cnpj ? ' · ' + row.cnpj : ''}
              </Button>
            ))}
          <p className="text-sm text-muted-foreground">
            Enter seleciona uma empresa encontrada ou consulta um CNPJ completo.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-cnpj">CNPJ</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="company-cnpj"
              aria-invalid={!!fieldErrors.cnpj}
              className="min-w-0 flex-1"
              {...form.register('cnpj')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void lookup(form.getValues('cnpj'));
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void lookup(form.getValues('cnpj'))}
            >
              {busy ? 'Consultando…' : 'Consultar CNPJ'}
            </Button>
          </div>
          {fieldErrors.cnpj && (
            <p role="alert" className="text-sm text-destructive">
              {fieldErrors.cnpj}
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="company-name">Razão social *</Label>
            <Input id="company-name" aria-invalid={!!fieldErrors.name} {...form.register('name')} />
            {fieldErrors.name && (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-trade">Nome fantasia</Label>
            <Input id="company-trade" {...form.register('trade_name')} />
          </div>
        </div>
        <section className="space-y-3">
          <h3 className="text-base font-semibold">Endereços</h3>
          {values.addresses.map((address, i) => (
            <fieldset key={i} className="min-w-0 space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm">Endereço {i + 1}</legend>
              <AddressFields
                id={'company-address-' + i}
                value={address}
                onChange={(value) => form.setValue(`addresses.${i}`, value)}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  form.setValue(
                    'addresses',
                    values.addresses.filter((_, index) => index !== i),
                  )
                }
              >
                Remover endereço {i + 1}
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => form.setValue('addresses', [...values.addresses, { ...blankAddress }])}
          >
            Adicionar endereço
          </Button>
        </section>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t p-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={busy || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando…' : 'Salvar empresa'}
        </Button>
      </footer>
    </form>
  );
}
