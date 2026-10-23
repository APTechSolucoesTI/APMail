import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BRAZIL_STATES, cnpjSchema, normalizeCnpj, type CompanyDetails } from '@apmail/shared';
import { api, ApiError } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { FormField } from './schema-form';

const groups = [
  {
    title: 'Dados cadastrais',
    fields: [
      ['legal_name', 'Razão social'],
      ['trade_name', 'Nome fantasia'],
      ['state_registration', 'Inscrição estadual'],
      ['municipal_registration', 'Inscrição municipal'],
    ],
  },
  {
    title: 'Endereço',
    fields: [
      ['postal_code', 'CEP'],
      ['street', 'Logradouro'],
      ['number', 'Número'],
      ['complement', 'Complemento'],
      ['district', 'Bairro'],
      ['city', 'Cidade'],
      ['state', 'UF'],
      ['country', 'País'],
    ],
  },
  {
    title: 'Contato',
    fields: [
      ['contact_name', 'Responsável pelo contato'],
      ['email', 'E-mail de contato'],
      ['phone', 'Telefone'],
      ['website', 'Site'],
    ],
  },
] as const;

function CompanyInput({
  name,
  label,
  type = 'text',
}: {
  name: string;
  label: string;
  type?: string;
}) {
  const form = useFormContext();
  const message = form.getFieldState(name, form.formState).error?.message;
  const id = 'company-' + name;
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {name === 'company_details.state' ? (
        <select
          id={id}
          {...form.register(name)}
          aria-invalid={!!message}
          aria-describedby={message ? id + '-error' : undefined}
          className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
        >
          <option value="">Selecione</option>
          {BRAZIL_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          type={type}
          {...form.register(name)}
          aria-invalid={!!message}
          aria-describedby={message ? id + '-error' : undefined}
        />
      )}
      {typeof message === 'string' && (
        <p id={id + '-error'} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

export function CompanyFields({ lookupPath }: { lookupPath: string }) {
  const form = useFormContext();
  const cnpj = String(useWatch({ control: form.control, name: 'company_details.cnpj' }) ?? '');
  const lastAttempt = useRef(normalizeCnpj(cnpj));
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [lookup, setLookup] = useState({ cnpj: '', loading: false, message: '', error: false });
  const currentLookup = lookup.cnpj === normalizeCnpj(cnpj);
  const loading = currentLookup && lookup.loading;
  const { trigger, getValues, setValue } = form;
  const lookupCompany = useCallback(
    async (value: string) => {
      const parsed = cnpjSchema.safeParse(value);
      if (!parsed.success) {
        void trigger('company_details.cnpj');
        return;
      }
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const request = ++sequence.current;
      const before = { ...(getValues('company_details') as CompanyDetails) };
      lastAttempt.current = parsed.data;
      setLookup({
        cnpj: parsed.data,
        loading: true,
        message: 'Consultando cadastro…',
        error: false,
      });
      try {
        const data = await api<CompanyDetails>(lookupPath + parsed.data, { signal: abort.signal });
        if (
          request !== sequence.current ||
          abort.signal.aborted ||
          normalizeCnpj(String(getValues('company_details.cnpj') ?? '')) !== parsed.data
        )
          return;
        for (const [key, value] of Object.entries(data)) {
          if (key === 'cnpj' || !value) continue;
          const path = 'company_details.' + key;
          if (getValues(path) === before[key as keyof CompanyDetails])
            setValue(path, value, { shouldDirty: true, shouldValidate: true });
        }
        setLookup({
          cnpj: parsed.data,
          loading: false,
          message: 'Cadastro consultado. Revise os dados antes de salvar.',
          error: false,
        });
      } catch (error) {
        if (request !== sequence.current || abort.signal.aborted) return;
        setLookup({
          cnpj: parsed.data,
          loading: false,
          message:
            error instanceof Error
              ? error.message
              : 'Não foi possível consultar. Preencha os dados manualmente.',
          error: true,
        });
      }
    },
    [getValues, lookupPath, setValue, trigger],
  );
  useEffect(() => {
    controller.current?.abort();
    ++sequence.current;
    const normalized = normalizeCnpj(cnpj);
    if (!cnpjSchema.safeParse(cnpj).success || normalized === lastAttempt.current) return;
    const timeout = setTimeout(() => void lookupCompany(cnpj), 500);
    return () => clearTimeout(timeout);
  }, [cnpj, lookupCompany]);
  useEffect(
    () => () => {
      controller.current?.abort();
      ++sequence.current;
    },
    [],
  );
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto]">
          <CompanyInput name="company_details.cnpj" label="CNPJ" />
          <Button
            className="sm:mt-6"
            type="button"
            variant="outline"
            disabled={loading || !cnpjSchema.safeParse(cnpj).success}
            onClick={() => void lookupCompany(cnpj)}
          >
            {loading ? 'Consultando…' : 'Consultar CNPJ'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ao informar um CNPJ válido, o cadastro público será consultado automaticamente. Todos os
          campos são opcionais e editáveis.
        </p>
        {currentLookup && lookup.message && (
          <p
            role="status"
            aria-live="polite"
            className={lookup.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
          >
            {lookup.message}
          </p>
        )}
      </div>
      {groups.map((group) => (
        <fieldset key={group.title} className="space-y-4 border-t pt-4">
          <legend className="px-1 text-sm font-semibold">{group.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map(([key, label]) => (
              <CompanyInput
                key={key}
                name={'company_details.' + key}
                label={label}
                type={
                  key === 'email'
                    ? 'email'
                    : key === 'phone'
                      ? 'tel'
                      : key === 'website'
                        ? 'url'
                        : 'text'
                }
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function CompanyForm({
  schema,
  defaults,
  fields = [],
  lookupPath,
  onSubmit,
}: {
  schema: z.ZodObject;
  defaults: Record<string, unknown>;
  fields?: FormField[];
  lookupPath: string;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
}) {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: defaults });
  const [error, setError] = useState('');
  return (
    <FormProvider {...form}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          try {
            await onSubmit(values);
            form.reset(values);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : 'Não foi possível salvar o cadastro.',
            );
            if (error instanceof ApiError && error.details)
              for (const [name, messages] of Object.entries(error.details))
                form.setError(name, { message: messages[0] });
          }
        })}
      >
        {!!fields.length && (
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <CompanyInput
                key={field.name}
                name={field.name}
                label={field.label}
                type={field.type === 'email' ? 'email' : 'text'}
              />
            ))}
          </div>
        )}
        <CompanyFields lookupPath={lookupPath} />
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? 'Salvando…' : 'Salvar cadastro'}
          </Button>
          <Button
            disabled={form.formState.isSubmitting}
            type="button"
            variant="outline"
            onClick={() => {
              form.reset(defaults);
              setError('');
            }}
          >
            Restaurar dados
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
