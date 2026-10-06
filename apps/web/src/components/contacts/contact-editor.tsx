import { useEffect, useState } from 'react';
import {
  useForm,
  useFieldArray,
  useWatch,
  type UseFormReturn,
  type FieldPath,
} from 'react-hook-form';
import { z } from 'zod';
import { Star, Plus, Trash2, Building2, MapPin, Mail, Phone } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contactSchema,
  isTenantAdmin,
  canDelegate,
  type ContactInput,
  type ContactDetail,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery, useTenantId, type Mailbox } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { toast } from 'sonner';
const emptyAddress = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  country: 'Brasil',
};
function useDebouncedSearch(value: string) {
  const [term, setTerm] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return term;
}
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
  const tenant = useTenantId();
  const q = useQuery({
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader>
          <DialogTitle>{id ? 'Editar contato' : 'Novo contato'}</DialogTitle>
          <DialogDescription>
            Organize empresas, endereços e canais de contato. Use a estrela para definir os dados
            principais.
          </DialogDescription>
        </DialogHeader>
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
                phone: '',
                job_title: '',
                phones: [],
                notes: '',
                emails: [{ email, label: '', is_primary: true, links: [] }],
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
  });
  const emails = useFieldArray({ control: form.control, name: 'emails' });
  const phones = useFieldArray({ control: form.control, name: 'phones' });
  const client = useQueryClient(),
    tenantId = useTenantId(),
    me = useQuery(meQuery).data;
  const tenant = me?.tenants.find((t) => t.id === tenantId);
  const mayControl =
    isTenantAdmin(tenant?.role) ||
    canDelegate(tenant?.role ?? null, tenant?.capabilities, 'contacts_visibility');
  const boxes = useQuery({
    queryKey: ['mailboxes', tenantId],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [linkId, setLinkId] = useState('');
  const searchTerm = useDebouncedSearch(search);
  const contacts = useQuery({
    queryKey: ['contact-link-options', tenantId, searchTerm],
    queryFn: ({ signal }) =>
      api<{ items: { id: string; name: string; emails: string[] }[] }>(
        '/contacts?' + new URLSearchParams({ search: searchTerm, pageSize: '10' }),
        { signal },
      ),
    enabled: !id && !!searchTerm,
  });
  const fields = [
    ['name', 'Nome'],
    ['job_title', 'Cargo'],
  ] as const;
  const watched = useWatch({ control: form.control }),
    visibility = watched.visibility ?? 'all';
  return (
    <form
      className="min-w-0 space-y-4 [&_fieldset]:min-w-0 [&_details]:min-w-0"
      noValidate
      onSubmit={(event) => {
        if (form.formState.isSubmitting) {
          event.preventDefault();
          return;
        }
        // Cross-field errors (e.g. duplicate channels) have no registered input.
        // Clear them before RHF checks submission, then validate the current values.
        form.clearErrors();
        void form.handleSubmit(async (values) => {
          setError('');
          try {
            const body = contactSchema.parse(values);
            if (!mayControl) {
              delete body.visibility;
              delete body.mailbox_ids;
            }
            if (linkId && !id) {
              const existing = await api<ContactDetail>('/contacts/' + linkId);
              const merged = {
                ...existing,
                phones: [
                  ...(existing.phones ?? []),
                  ...(body.phones ?? []).map((p) => ({ ...p, is_primary: false })),
                ],
                emails: [
                  ...existing.emails,
                  ...body.emails.map((e) => ({
                    ...e,
                    is_primary: false,
                    links: e.links.map((l) => ({ ...l, is_primary_company: false })),
                  })),
                ],
              };
              if (!mayControl) {
                delete (merged as ContactInput).visibility;
                delete (merged as ContactInput).mailbox_ids;
              }
              await api('/contacts/' + linkId, {
                method: 'PUT',
                body: contactSchema.parse(merged),
              });
            } else
              await api(id ? '/contacts/' + id : '/contacts', {
                method: id ? 'PUT' : 'POST',
                body,
              });
            await client.invalidateQueries({
              predicate: (q) =>
                String(q.queryKey[0]).startsWith('contact') || q.queryKey[0] === 'global-search',
            });
            toast.success('Contato salvo.');
            onClose();
          } catch (e) {
            if (e instanceof z.ZodError) {
              for (const issue of e.issues)
                form.setError(issue.path.join('.') as FieldPath<ContactInput>, {
                  type: 'validate',
                  message: issue.message,
                });
              const first = e.issues[0];
              if (first) form.setFocus(first.path.join('.') as FieldPath<ContactInput>);
              setError('Revise os campos indicados antes de salvar.');
            } else setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
          }
        })(event);
      }}
    >
      {!id && (
        <fieldset className="space-y-2 rounded-md border p-3">
          <legend>Criar ou vincular</legend>
          <Label htmlFor="link-contact-search">Buscar contato existente pelo nome ou e-mail</Label>
          <Input
            id="link-contact-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Label htmlFor="link-contact">Destino</Label>
          <select
            id="link-contact"
            className="h-11 w-full rounded-md border bg-card px-2 text-sm"
            value={linkId}
            onChange={(e) => {
              setLinkId(e.target.value);
              const selected = contacts.data?.items.find((c) => c.id === e.target.value);
              if (selected) form.setValue('name', selected.name);
            }}
          >
            <option value="">Criar novo contato</option>
            {contacts.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.emails.join(', ')}
              </option>
            ))}
          </select>
          {linkId && (
            <p className="text-sm text-muted-foreground">
              Os e-mails e vínculos abaixo serão adicionados ao contato selecionado.
            </p>
          )}
        </fieldset>
      )}
      {!linkId && (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={'contact-' + key}>{label}</Label>
              <Input
                id={'contact-' + key}
                {...form.register(key)}
                aria-invalid={!!form.formState.errors[key]}
              />
              <FieldMessage form={form} name={key} />
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border p-4">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Mail className="size-4" aria-hidden />
          E-mails
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Cada e-mail pode ter várias empresas e endereços. O principal identifica este contato na
          listagem.
        </p>
        <FieldMessage form={form} name="emails" />
        {emails.fields.map((entry, index) => (
          <fieldset key={entry.id} className="mb-3 space-y-3 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium">
              E-mail {index + 1}
              {watched.emails?.[index]?.is_primary ? ' · Principal' : ''}
            </legend>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <Label htmlFor={'contact-email-' + entry.id}>Endereço de e-mail</Label>
                <Input
                  id={'contact-email-' + entry.id}
                  type="email"
                  {...form.register(`emails.${index}.email`)}
                  aria-invalid={!!form.getFieldState(`emails.${index}.email`, form.formState).error}
                />
                <FieldMessage form={form} name={`emails.${index}.email`} />
              </div>
              <div>
                <Label htmlFor={'contact-label-' + entry.id}>Identificação</Label>
                <Input
                  id={'contact-label-' + entry.id}
                  {...form.register(`emails.${index}.label`)}
                />
              </div>
              <div className="flex gap-1">
                <PrimaryButton
                  active={!!watched.emails?.[index]?.is_primary}
                  label={`Definir e-mail ${index + 1} como principal`}
                  onClick={() =>
                    form
                      .getValues('emails')
                      .forEach((_, i) =>
                        form.setValue(`emails.${i}.is_primary`, i === index, { shouldDirty: true }),
                      )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-9"
                  aria-label={`Remover e-mail ${index + 1}`}
                  disabled={emails.fields.length === 1}
                  onClick={() => {
                    emails.remove(index);
                    repairPrimaries(form);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <details className="border-t pt-2">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Empresas e endereços ({watched.emails?.[index]?.links?.length ?? 0})
              </summary>
              <EmailLinks key={`${entry.id}-${index}`} index={index} form={form} />
            </details>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => emails.append({ email: '', label: '', is_primary: false, links: [] })}
        >
          <Plus aria-hidden className="size-4" />
          Adicionar e-mail
        </Button>
      </div>
      <section className="space-y-3 rounded-lg border p-4" aria-label="Telefones do contato">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Phone aria-hidden className="size-4" />
          Telefones <span className="text-xs font-normal text-muted-foreground">Opcional</span>
        </h3>
        <FieldMessage form={form} name="phones" />
        {phones.fields.map((phone, index) => (
          <fieldset
            key={phone.id}
            className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <legend className="px-1 text-xs font-medium">
              Telefone {index + 1}
              {watched.phones?.[index]?.is_primary ? ' · Principal' : ''}
            </legend>
            <div className="space-y-2">
              <Label htmlFor={phone.id + 'number'}>Número</Label>
              <Input
                id={phone.id + 'number'}
                type="tel"
                {...form.register(`phones.${index}.number`)}
                aria-invalid={!!form.getFieldState(`phones.${index}.number`, form.formState).error}
              />
              <FieldMessage form={form} name={`phones.${index}.number`} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={phone.id + 'label'}>Identificação</Label>
              <Input id={phone.id + 'label'} {...form.register(`phones.${index}.label`)} />
            </div>
            <div className="flex gap-1">
              <PrimaryButton
                active={!!watched.phones?.[index]?.is_primary}
                label={`Definir telefone ${index + 1} como principal`}
                onClick={() =>
                  form
                    .getValues('phones')
                    ?.forEach((_, i) =>
                      form.setValue(`phones.${i}.is_primary`, i === index, { shouldDirty: true }),
                    )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-9"
                aria-label={`Remover telefone ${index + 1}`}
                onClick={() => {
                  phones.remove(index);
                  repairPrimaries(form);
                }}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          </fieldset>
        ))}
        {!phones.fields.length && (
          <p className="text-xs text-muted-foreground">Nenhum telefone cadastrado.</p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            phones.append({ number: '', label: '', is_primary: !phones.fields.length })
          }
        >
          <Plus aria-hidden className="size-4" />
          Adicionar telefone
        </Button>
      </section>
      {!linkId && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
            Observações
          </summary>
          <div className="mt-3 space-y-2">
            <Label htmlFor="contact-notes">Observações sobre o contato</Label>
            <Textarea id="contact-notes" {...form.register('notes')} />
            <FieldMessage form={form} name="notes" />
          </div>
        </details>
      )}
      {mayControl && !linkId && (
        <fieldset className="space-y-3 rounded-md border p-3">
          <legend>Exibição do contato</legend>
          <Label htmlFor="contact-visibility">Caixas autorizadas</Label>
          <select
            id="contact-visibility"
            {...form.register('visibility')}
            className="h-11 w-full rounded-md border bg-card px-2 text-sm"
          >
            <option value="all">Todas as caixas atuais e futuras</option>
            <option value="selected">Somente caixas selecionadas</option>
          </select>
          {visibility === 'selected' &&
            boxes.data?.map((box) => (
              <div key={box.id} className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={'visible-' + box.id}
                  checked={watched.mailbox_ids?.includes(box.id) ?? false}
                  onCheckedChange={(checked) =>
                    form.setValue(
                      'mailbox_ids',
                      checked
                        ? [...(form.getValues('mailbox_ids') ?? []), box.id]
                        : (form.getValues('mailbox_ids') ?? []).filter((v) => v !== box.id),
                    )
                  }
                />
                <Label htmlFor={'visible-' + box.id}>{box.name}</Label>
              </div>
            ))}
          <p className="text-sm text-muted-foreground">
            Quem tiver acesso a uma caixa autorizada poderá ver o contato completo.
          </p>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando…' : 'Salvar contato'}
        </Button>
      </div>
    </form>
  );
}
function PrimaryButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-11 sm:size-9"
      aria-label={label}
      aria-pressed={active}
      title={active ? 'Principal' : label}
      onClick={onClick}
    >
      <Star
        aria-hidden
        className={active ? 'size-4 fill-current text-primary' : 'size-4 text-muted-foreground'}
      />
    </Button>
  );
}
function FieldMessage({
  form,
  name,
}: {
  form: UseFormReturn<ContactInput>;
  name: FieldPath<ContactInput>;
}) {
  const error = form.getFieldState(name, form.formState).error;
  return error?.message ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {error.message}
    </p>
  ) : null;
}
function repairPrimaries(form: UseFormReturn<ContactInput>) {
  const emails = form.getValues('emails');
  if (!emails.some((e) => e.is_primary) && emails.length)
    form.setValue('emails.0.is_primary', true);
  if (!emails.some((e) => e.links.some((l) => l.is_primary_company))) {
    const emailIndex = emails.findIndex((e) => e.links.some((l) => l.company));
    if (emailIndex >= 0)
      form.setValue(
        `emails.${emailIndex}.links.${emails[emailIndex]!.links.findIndex((l) => l.company)}.is_primary_company`,
        true,
      );
  }
  const phones = form.getValues('phones');
  if (phones?.length && !phones.some((p) => p.is_primary))
    form.setValue('phones.0.is_primary', true);
}
function EmailLinks({ index, form }: { index: number; form: UseFormReturn<ContactInput> }) {
  const links = useFieldArray({ control: form.control, name: `emails.${index}.links` });
  const watchedLinks = useWatch({ control: form.control, name: `emails.${index}.links` });
  const [busy, setBusy] = useState<string | null>(null);
  const tenant = useTenantId(),
    [companySearch, setCompanySearch] = useState(''),
    [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const companyTerm = useDebouncedSearch(companySearch);
  const companies = useQuery({
    queryKey: ['contact-company-options', tenant, companyTerm],
    queryFn: ({ signal }) =>
      api<{ items: { id: string; name: string; trade_name: string; cnpj: string }[] }>(
        '/contacts/companies?' + new URLSearchParams({ search: companyTerm }),
        { signal },
      ),
    staleTime: 30000,
    enabled: companyPickerOpen,
  });
  const lookup = async (kind: 'cep' | 'cnpj', linkIndex: number) => {
    const key = `emails.${index}.links.${linkIndex}` as const;
    const value =
      kind === 'cep' ? form.getValues(`${key}.address.cep`) : form.getValues(`${key}.company.cnpj`);
    setBusy(key + kind);
    try {
      const data = await api<{
        company?: ContactInput['emails'][number]['links'][number]['company'];
        address: typeof emptyAddress;
      }>('/contacts/lookup/' + kind + '/' + encodeURIComponent(value ?? ''));
      if (data.company) form.setValue(`${key}.company`, data.company);
      form.setValue(`${key}.address`, data.address);
      toast.success('Dados consultados. Confira antes de salvar.');
    } catch (e) {
      toast.error(
        (e instanceof Error ? e.message + ' ' : '') + 'Você pode preencher os dados manualmente.',
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3 [&_button]:max-w-full [&_button]:whitespace-normal">
      {links.fields.map((link, li) => {
        const key = `emails.${index}.links.${li}` as const,
          current = watchedLinks?.[li];
        return (
          <details
            key={link.id}
            open={link.company?.name === '' || (!link.company && !link.address?.street)}
            className="rounded-md border p-3"
          >
            <summary className="min-h-11 cursor-pointer break-words py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
              {current?.company?.name ||
                (current?.company ? 'Nova empresa' : current?.address?.street || 'Novo endereço')}
              {current?.is_primary_company ? ' · Empresa principal' : ''}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor={link.id + 'label'}>Identificação do vínculo</Label>
                  <Input id={link.id + 'label'} {...form.register(`${key}.label`)} />
                </div>
                {current?.company && (
                  <PrimaryButton
                    active={!!current.is_primary_company}
                    label={`Definir empresa ${li + 1} do e-mail ${index + 1} como principal`}
                    onClick={() =>
                      form
                        .getValues('emails')
                        .forEach((e, ei) =>
                          e.links.forEach((_, i) =>
                            form.setValue(
                              `emails.${ei}.links.${i}.is_primary_company`,
                              ei === index && i === li,
                              { shouldDirty: true },
                            ),
                          ),
                        )
                    }
                  />
                )}
              </div>
              {current?.company && (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={link.id + 'cnpj'}>CNPJ</Label>
                      <Input id={link.id + 'cnpj'} {...form.register(`${key}.company.cnpj`)} />
                      <FieldMessage form={form} name={`${key}.company.cnpj`} />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => void lookup('cnpj', li)}
                    >
                      Consultar CNPJ
                    </Button>
                  </div>
                  {(['name', 'trade_name'] as const).map((field, i) => (
                    <div key={field}>
                      <Label htmlFor={link.id + field}>
                        {i ? 'Nome fantasia' : 'Razão social'}
                      </Label>
                      <Input id={link.id + field} {...form.register(`${key}.company.${field}`)} />
                      <FieldMessage form={form} name={`${key}.company.${field}`} />
                    </div>
                  ))}
                </>
              )}
              {current?.company && !current.address && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    form.setValue(`${key}.address`, { ...emptyAddress }, { shouldDirty: true })
                  }
                >
                  <MapPin aria-hidden className="size-4" />
                  Adicionar endereço desta empresa
                </Button>
              )}
              {current?.address && (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1">
                      <Label htmlFor={link.id + 'cep'}>CEP</Label>
                      <Input id={link.id + 'cep'} {...form.register(`${key}.address.cep`)} />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => void lookup('cep', li)}
                    >
                      Consultar CEP
                    </Button>
                  </div>
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
                    ).map(([field, label]) => (
                      <div key={field}>
                        <Label htmlFor={link.id + field}>{label}</Label>
                        <Input id={link.id + field} {...form.register(`${key}.address.${field}`)} />
                      </div>
                    ))}
                  </div>
                </>
              )}
              {busy?.startsWith(key) && (
                <p role="status" className="text-sm">
                  Consultando…
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={!!busy}
                onClick={() => {
                  links.remove(li);
                  repairPrimaries(form);
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                Remover vínculo
              </Button>
            </div>
          </details>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            links.append({
              label: '',
              is_primary_company: !form
                .getValues('emails')
                .some((e) => e.links.some((l) => l.is_primary_company)),
              company: { name: '', trade_name: '', cnpj: '' },
              address: { ...emptyAddress },
            })
          }
        >
          <Building2 aria-hidden className="size-4" />
          Adicionar empresa e endereço
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => links.append({ label: '', company: null, address: { ...emptyAddress } })}
        >
          <MapPin aria-hidden className="size-4" />
          Adicionar endereço por CEP
        </Button>
      </div>
      <details
        className="rounded-md border p-3"
        onToggle={(event) => setCompanyPickerOpen(event.currentTarget.open)}
      >
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
          Vincular empresa já cadastrada
        </summary>
        <div className="mt-3 space-y-2">
          <Label htmlFor={`company-search-${index}`}>Buscar por empresa ou CNPJ</Label>
          <Input
            id={`company-search-${index}`}
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
          />
          <Label htmlFor={`company-picker-${index}`}>Empresa para este e-mail</Label>
          <select
            id={`company-picker-${index}`}
            className="h-11 w-full max-w-full rounded-md border bg-card px-3 text-sm"
            value=""
            onChange={(e) => {
              const company = companies.data?.items[Number(e.target.value)];
              if (company)
                links.append({
                  label: '',
                  company,
                  address: null,
                  is_primary_company: !form
                    .getValues('emails')
                    .some((email) => email.links.some((l) => l.is_primary_company)),
                });
            }}
          >
            <option value="">
              {companies.isLoading ? 'Carregando empresas…' : 'Selecionar empresa'}
            </option>
            {companies.data?.items.map((company, i) => (
              <option key={i} value={i}>
                {company.trade_name || company.name}
                {company.cnpj ? ` · ${company.cnpj}` : ''}
              </option>
            ))}
          </select>
          {companies.error && (
            <p role="status" className="text-xs text-destructive">
              Não foi possível consultar empresas. Você pode cadastrá-las manualmente.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Empresas dos contatos que você pode visualizar. Refine a busca para encontrar outras.
          </p>
        </div>
      </details>
    </div>
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
