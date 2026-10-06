import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contactSchema,
  type ContactInput,
  type ContactDetail,
  type CompanyDetail,
  type ListResult,
} from '@apmail/shared';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import {
  DirectoryHeader,
  DirectoryVisibility,
  PrincipalChips,
  ChannelPicker,
  useDirectorySearch,
  useDirectoryControl,
} from './directory-fields';
import { CompanyEditorDialog } from './company-editor';
import { AddressFields, blankAddress } from './address-fields';
import { toast } from 'sonner';
type Company = NonNullable<ContactInput['emails'][number]['links'][number]['company']>;
const companyKey = (c: Company) => c.id || c.cnpj || c.name;
type ContactAddress = { address: typeof blankAddress; emailIndex: number; companyKey: string };
export function ContactEditorDialog({
  id,
  email = '',
  name = '',
  onClose,
}: {
  id?: string;
  email?: string;
  name?: string;
  onClose: () => void;
}) {
  const tenant = useTenantId(),
    q = useQuery({
      queryKey: ['contact', tenant, id],
      queryFn: () => api<ContactDetail>('/contacts/' + id),
      enabled: !!id,
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[min(90dvh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DirectoryHeader
          title={id ? 'Editar contato' : 'Novo contato'}
          description="Vincule empresas e organize os canais de contato. Campos com * são obrigatórios."
        />
        {id && q.isLoading ? (
          <LoadingState />
        ) : id && q.error ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          <ContactForm
            key={id ?? 'new'}
            id={id}
            initial={
              q.data ?? {
                name,
                job_title: '',
                phone: '',
                phones: [],
                notes: '',
                emails: email ? [{ email, label: '', is_primary: true, links: [] }] : [],
                visibility: 'all',
                mailbox_ids: [],
              }
            }
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function ContactForm({
  id,
  initial,
  onClose,
}: {
  id?: string;
  initial: ContactInput;
  onClose: () => void;
}) {
  const form = useForm<ContactInput>({
      defaultValues: {
        ...initial,
        phones:
          initial.phones ??
          (initial.phone ? [{ number: initial.phone, label: '', is_primary: true }] : []),
      },
    }),
    values = useWatch({ control: form.control, compute: () => form.getValues() }),
    client = useQueryClient(),
    tenant = useTenantId(),
    mayControl = useDirectoryControl();
  const originalLinks = initial.emails.flatMap((e) => e.links),
    originalCompanies = originalLinks.flatMap((l) => (l.company ? [l.company] : []));
  const [companies, setCompanies] = useState<Company[]>(() => [
    ...new Map(originalCompanies.map((c) => [companyKey(c), c])).values(),
  ]);
  const [primaryCompany, setPrimaryCompany] = useState(() => {
    const primary = originalLinks.find((l) => l.is_primary_company)?.company;
    return primary
      ? companyKey(primary)
      : originalCompanies[0]
        ? companyKey(originalCompanies[0])
        : '';
  });
  const [addresses, setAddresses] = useState<ContactAddress[]>(() =>
    initial.emails.flatMap((e, emailIndex) =>
      e.links.flatMap((l) =>
        l.address
          ? [{ address: l.address, emailIndex, companyKey: l.company ? companyKey(l.company) : '' }]
          : [],
      ),
    ),
  );
  const [search, setSearch] = useState(''),
    term = useDirectorySearch(search),
    [pickerOpen, setPickerOpen] = useState(false),
    [newCompany, setNewCompany] = useState<{ cnpj: string } | null>(null),
    [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const options = useQuery({
    queryKey: ['company-options', tenant, term, 50],
    queryFn: ({ signal }) =>
      api<ListResult<CompanyDetail>>(
        '/companies?' + new URLSearchParams({ search: term, pageSize: '50' }),
        { signal },
      ),
    enabled: pickerOpen,
  });
  const selectCompany = (company: Company | CompanyDetail) => {
    const key = companyKey(company);
    setCompanies((current) =>
      current.some((c) => companyKey(c) === key)
        ? current.map((c) => (companyKey(c) === key ? company : c))
        : [...current, company],
    );
    if (!primaryCompany) setPrimaryCompany(key);
    if (!companies.some((c) => companyKey(c) === key) && 'addresses' in company)
      setAddresses((current) => [
        ...current,
        ...company.addresses.map((address) => ({
          address,
          emailIndex: Math.max(
            0,
            form.getValues('emails').findIndex((e) => e.is_primary),
          ),
          companyKey: key,
        })),
      ]);
    const emails = form.getValues('emails');
    if (!emails.some((e) => e.links.some((l) => l.company && companyKey(l.company) === key))) {
      const index = Math.max(
        0,
        emails.findIndex((e) => e.is_primary),
      );
      if (emails[index])
        form.setValue(`emails.${index}.links`, [
          ...emails[index]!.links,
          { company, address: null, label: '', is_primary_company: false },
        ]);
    }
  };
  const removeCompany = (key: string) => {
    const remaining = companies.filter((c) => companyKey(c) !== key);
    setCompanies(remaining);
    if (primaryCompany === key) setPrimaryCompany(remaining[0] ? companyKey(remaining[0]) : '');
    setAddresses((current) =>
      current.map((a) => (a.companyKey === key ? { ...a, companyKey: '' } : a)),
    );
    form.setValue(
      'emails',
      values.emails.map((e) => ({
        ...e,
        links: e.links.filter((l) => !l.company || companyKey(l.company) !== key),
      })),
    );
  };
  const toggleCompany = (company: Company) =>
    companies.some((c) => companyKey(c) === companyKey(company))
      ? removeCompany(companyKey(company))
      : selectCompany(company);
  const enterCompanySearch = async () => {
    let match: CompanyDetail | undefined;
    try {
      match = (
        await api<ListResult<CompanyDetail>>(
          '/companies?' + new URLSearchParams({ search: search.trim(), pageSize: '10' }),
        )
      ).items[0];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível buscar empresas.');
      return;
    }
    if (match) selectCompany(match);
    else if (/^[A-Z\d]{12}\d{2}$/.test(search.replace(/[.\-/\s]/g, '').toUpperCase())) {
      setPickerOpen(false);
      setNewCompany({ cnpj: search });
    }
  };
  const removeEmail = (index: number) => {
    const remaining = values.emails.filter((_, i) => i !== index);
    if (remaining.length && !remaining.some((e) => e.is_primary)) remaining[0]!.is_primary = true;
    for (const company of companies)
      if (
        remaining.length &&
        !remaining.some((e) =>
          e.links.some((l) => l.company && companyKey(l.company) === companyKey(company)),
        )
      )
        remaining[0]!.links.push({ company, address: null, label: '', is_primary_company: false });
    form.setValue('emails', remaining);
    setAddresses((current) =>
      current.map((a) => ({
        ...a,
        emailIndex:
          a.emailIndex === index ? 0 : a.emailIndex > index ? a.emailIndex - 1 : a.emailIndex,
      })),
    );
  };
  const save = form.handleSubmit(async (raw) => {
    setError('');
    setFieldErrors({});
    try {
      const emails: ContactInput['emails'] = raw.emails.map((e) => ({
        ...e,
        label: e.label ?? '',
        links: e.links
          .filter(
            (l) => l.company && companies.some((c) => companyKey(c) === companyKey(l.company!)),
          )
          .map((l) => ({ ...l, label: '', address: null, is_primary_company: false })),
      }));
      for (const company of companies)
        if (
          !emails.some((e) =>
            e.links.some((l) => l.company && companyKey(l.company) === companyKey(company)),
          )
        ) {
          const email = emails.find((e) => e.is_primary) ?? emails[0];
          email?.links.push({ company, address: null, label: '', is_primary_company: false });
        }
      for (const entry of addresses) {
        const email = emails[entry.emailIndex] ?? emails[0];
        if (!email) continue;
        const company = companies.find((c) => companyKey(c) === entry.companyKey) ?? null;
        const existing = company
          ? email.links.find(
              (l) => l.company && companyKey(l.company) === companyKey(company) && !l.address,
            )
          : null;
        if (existing) existing.address = entry.address;
        else
          email.links.push({
            company,
            address: entry.address,
            label: '',
            is_primary_company: false,
          });
      }
      const principal = emails
        .flatMap((e) => e.links)
        .find((l) => l.company && companyKey(l.company) === primaryCompany);
      if (principal) principal.is_primary_company = true;
      const body = contactSchema.parse({ ...raw, emails });
      if (!mayControl) {
        delete body.visibility;
        delete body.mailbox_ids;
      }
      await api(id ? '/contacts/' + id : '/contacts', { method: id ? 'PUT' : 'POST', body });
      await client.invalidateQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith('contact') || q.queryKey[0] === 'global-search',
      });
      toast.success('Contato salvo.');
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
  });
  return (
    <>
      <form
        className="flex min-h-0 flex-1 flex-col"
        noValidate
        onSubmit={(event) => {
          if (form.formState.isSubmitting) {
            event.preventDefault();
            return;
          }
          void save(event);
        }}
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          <section className="space-y-3">
            <Label>Empresas (opcional)</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-between font-normal"
                  aria-label="Selecionar empresas"
                >
                  <span>
                    {companies.length}{' '}
                    {companies.length === 1 ? 'empresa selecionada' : 'empresas selecionadas'}
                  </span>
                  <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="max-h-[55dvh] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto"
              >
                <Label htmlFor="contact-company-search">
                  Pesquisar por CNPJ, razão social ou nome fantasia
                </Label>
                <Input
                  id="contact-company-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void enterCompanySearch();
                    }
                  }}
                />
                {options.isLoading ? (
                  <p role="status" className="text-sm">
                    Carregando empresas…
                  </p>
                ) : options.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    Não foi possível buscar empresas.
                  </p>
                ) : !options.data?.items.length ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Nenhuma empresa encontrada. Cadastre uma nova ou informe o CNPJ e pressione
                    Enter.
                  </p>
                ) : (
                  options.data.items.map((company) => (
                    <div
                      key={company.id}
                      className="flex min-h-11 items-center gap-3 rounded-md p-2 hover:bg-muted"
                    >
                      <Checkbox
                        id={'company-option-' + company.id}
                        checked={companies.some((c) => companyKey(c) === company.id)}
                        onCheckedChange={() => toggleCompany(company)}
                      />
                      <Label
                        htmlFor={'company-option-' + company.id}
                        className="min-w-0 flex-1 cursor-pointer break-words"
                      >
                        <span>{company.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {company.trade_name}
                          {company.cnpj ? ' · ' + company.cnpj : ''}
                        </span>
                      </Label>
                    </div>
                  ))
                )}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPickerOpen(false);
                      setNewCompany({ cnpj: '' });
                    }}
                  >
                    <Plus aria-hidden className="size-4" />
                    Nova empresa
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
                    Concluir
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <PrincipalChips
              items={companies.map((c) => ({
                key: companyKey(c),
                text: c.name,
                primary: companyKey(c) === primaryCompany,
              }))}
              onPrimary={setPrimaryCompany}
              onRemove={removeCompany}
            />
            <p className="text-sm text-muted-foreground">
              Selecione uma ou mais empresas. Use a estrela para definir a principal. O vínculo é
              opcional.
            </p>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Nome *</Label>
              <Input
                id="contact-name"
                aria-invalid={!!fieldErrors.name}
                {...form.register('name')}
              />
              {fieldErrors.name && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldErrors.name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-job">Cargo</Label>
              <Input id="contact-job" {...form.register('job_title')} />
            </div>
          </div>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <ChannelPicker
              kind="email"
              error={fieldErrors.emails}
              items={values.emails.map((e) => ({ value: e.email, primary: !!e.is_primary }))}
              onAdd={(email) =>
                form.setValue('emails', [
                  ...values.emails,
                  {
                    email,
                    label: '',
                    is_primary: !values.emails.length,
                    links: values.emails.length
                      ? []
                      : companies.map((company) => ({
                          company,
                          address: null,
                          label: '',
                          is_primary_company: false,
                        })),
                  },
                ])
              }
              onEdit={(i, email) => form.setValue(`emails.${i}.email`, email)}
              onRemove={removeEmail}
              onPrimary={(index) =>
                form.setValue(
                  'emails',
                  values.emails.map((e, i) => ({ ...e, is_primary: i === index })),
                )
              }
            >
              <details className="border-t pt-2">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                  Empresas por e-mail
                </summary>
                <p className="mb-2 text-xs text-muted-foreground">
                  Por padrão, empresas selecionadas são vinculadas ao e-mail principal. Ajuste os
                  vínculos abaixo se necessário.
                </p>
                {values.emails.map((email, ei) => (
                  <fieldset key={ei} className="min-w-0 space-y-2 rounded-md border p-2">
                    <legend className="break-all text-sm">{email.email}</legend>
                    {companies.map((company) => {
                      const key = companyKey(company),
                        linked = email.links.some(
                          (l) => l.company && companyKey(l.company) === key,
                        );
                      return (
                        <div key={key} className="flex min-h-11 items-center gap-2">
                          <Checkbox
                            id={'email-company-' + ei + key}
                            checked={linked}
                            onCheckedChange={(checked) =>
                              form.setValue(
                                `emails.${ei}.links`,
                                checked
                                  ? [
                                      ...email.links,
                                      {
                                        company,
                                        address: null,
                                        label: '',
                                        is_primary_company: false,
                                      },
                                    ]
                                  : email.links.filter(
                                      (l) => !l.company || companyKey(l.company) !== key,
                                    ),
                              )
                            }
                          />
                          <Label htmlFor={'email-company-' + ei + key} className="break-words">
                            {company.name}
                          </Label>
                        </div>
                      );
                    })}
                  </fieldset>
                ))}
              </details>
            </ChannelPicker>
            <ChannelPicker
              kind="phone"
              error={fieldErrors.phones}
              items={(values.phones ?? []).map((p) => ({
                value: p.number,
                primary: !!p.is_primary,
              }))}
              onAdd={(number) =>
                form.setValue('phones', [
                  ...(values.phones ?? []),
                  { number, label: '', is_primary: !values.phones?.length },
                ])
              }
              onEdit={(i, number) => form.setValue(`phones.${i}.number`, number)}
              onPrimary={(index) =>
                form.setValue(
                  'phones',
                  values.phones?.map((p, i) => ({ ...p, is_primary: i === index })),
                )
              }
              onRemove={(index) => {
                const remaining = values.phones?.filter((_, i) => i !== index) ?? [];
                if (remaining.length && !remaining.some((p) => p.is_primary))
                  remaining[0]!.is_primary = true;
                form.setValue('phones', remaining);
              }}
            />
          </div>
          <details className="rounded-md border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
              Endereços do contato{addresses.length ? ' (' + addresses.length + ')' : ''}
            </summary>
            <div className="space-y-3 pt-3">
              {addresses.map((entry, i) => (
                <fieldset key={i} className="min-w-0 space-y-3 rounded-md border p-3">
                  <legend className="px-1 text-sm">Endereço {i + 1}</legend>
                  <Label htmlFor={'address-company-' + i}>Empresa vinculada (opcional)</Label>
                  <select
                    id={'address-company-' + i}
                    className="h-11 w-full rounded-md border bg-card px-3 text-sm"
                    value={entry.companyKey}
                    onChange={(e) =>
                      setAddresses((current) =>
                        current.map((a, index) =>
                          index === i ? { ...a, companyKey: e.target.value } : a,
                        ),
                      )
                    }
                  >
                    <option value="">Endereço avulso</option>
                    {companies.map((c) => (
                      <option key={companyKey(c)} value={companyKey(c)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Label htmlFor={'address-email-' + i}>E-mail vinculado</Label>
                  <select
                    id={'address-email-' + i}
                    className="h-11 w-full rounded-md border bg-card px-3 text-sm"
                    value={entry.emailIndex}
                    onChange={(e) =>
                      setAddresses((current) =>
                        current.map((a, index) =>
                          index === i ? { ...a, emailIndex: Number(e.target.value) } : a,
                        ),
                      )
                    }
                  >
                    {values.emails.map((e, index) => (
                      <option key={index} value={index}>
                        {e.email}
                      </option>
                    ))}
                  </select>
                  <AddressFields
                    id={'contact-address-' + i}
                    value={entry.address}
                    onChange={(address) =>
                      setAddresses((current) =>
                        current.map((a, index) => (index === i ? { ...a, address } : a)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setAddresses((current) => current.filter((_, index) => index !== i))
                    }
                  >
                    Remover endereço {i + 1}
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setAddresses((current) => [
                    ...current,
                    {
                      address: { ...blankAddress },
                      emailIndex: Math.max(
                        0,
                        values.emails.findIndex((e) => e.is_primary),
                      ),
                      companyKey: '',
                    },
                  ])
                }
              >
                Adicionar endereço avulso
              </Button>
            </div>
          </details>
          <details className="rounded-md border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
              Observações
            </summary>
            <div className="space-y-2 pt-3">
              <Label htmlFor="contact-notes">Observações sobre o contato</Label>
              <Textarea id="contact-notes" {...form.register('notes')} />
            </div>
          </details>
          <DirectoryVisibility
            value={values}
            onChange={(next) => {
              form.setValue('visibility', next.visibility);
              form.setValue('mailbox_ids', next.mailbox_ids);
            }}
          />
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
          <Button disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Salvando…' : 'Salvar contato'}
          </Button>
        </footer>
      </form>
      {newCompany && (
        <CompanyEditorDialog
          cnpj={newCompany.cnpj}
          onClose={() => setNewCompany(null)}
          onSaved={selectCompany}
        />
      )}
    </>
  );
}
export function ContactSenderAction({ email, name }: { email: string; name: string }) {
  const [editing, setEditing] = useState<{ id?: string } | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const data = await api<{ items: { id: string }[] }>(
              '/contacts?' + new URLSearchParams({ email }),
            );
            setEditing(data.items[0] ? { id: data.items[0].id } : {});
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Falha ao consultar contato.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Contato
      </Button>
      {editing && (
        <ContactEditorDialog
          id={editing.id}
          email={email}
          name={name}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
