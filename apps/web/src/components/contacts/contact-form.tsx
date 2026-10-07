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
import { ChevronsUpDown, Plus, Send, History } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import {
  DirectoryHeader,
  PrincipalChips,
  ChannelPicker,
  useDirectorySearch,
} from './directory-fields';
import { CompanyEditorDialog } from './company-editor';
import { CompanyInfo } from './company-info';
import { ContactSendDialog } from './contact-send';
import { ContactHistory } from './contact-history';
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
    user = useQuery(meQuery).data?.user.id;
  const q = useQuery({
    queryKey: ['contact', tenant, user, id],
    queryFn: ({ signal }) => api<ContactDetail>('/contacts/' + id, { signal }),
    enabled: !!id,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[min(90dvh,44rem)] flex-col gap-0 p-0 sm:max-w-5xl">
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
                nickname: '',
                phone: '',
                phones: [],
                notes: '',
                companies: [],
                emails: email ? [{ email, label: '', is_primary: true, links: [] }] : [],
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
      companies: initial.companies ?? [],
      nickname: initial.nickname ?? '',
      phones:
        initial.phones ??
        (initial.phone ? [{ number: initial.phone, label: '', is_primary: true }] : []),
    },
  });
  const values = useWatch({ control: form.control, compute: () => form.getValues() }),
    tenant = useTenantId(),
    client = useQueryClient();
  const dirty = form.formState.isDirty;
  const [search, setSearch] = useState(''),
    term = useDirectorySearch(search),
    [pickerOpen, setPickerOpen] = useState(false),
    [newCompany, setNewCompany] = useState<{ cnpj: string } | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sendContact, setSendContact] = useState<ContactDetail | null>(null),
    [confirmSend, setConfirmSend] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
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
  const companies = values.companies;
  const selectCompany = (company: CompanyDetail) => {
    const current = form.getValues('companies');
    form.setValue(
      'companies',
      current.some((c) => c.id === company.id)
        ? current.map((c) => (c.id === company.id ? { ...company, is_primary: c.is_primary } : c))
        : [...current, { ...company, is_primary: !current.length }],
      { shouldDirty: true },
    );
  };
  const removeCompany = (key: string) => {
    const remaining = companies.filter((c) => c.id !== key);
    if (remaining.length && !remaining.some((c) => c.is_primary)) remaining[0]!.is_primary = true;
    form.setValue('companies', remaining, { shouldDirty: true });
  };
  const toggleCompany = (company: CompanyDetail) =>
    companies.some((c) => c.id === company.id) ? removeCompany(company.id) : selectCompany(company);
  const enterCompanySearch = async () => {
    try {
      const match = (
        await api<ListResult<CompanyDetail>>(
          '/companies?' + new URLSearchParams({ search: search.trim(), pageSize: '10' }),
        )
      ).items[0];
      if (match) selectCompany(match);
      else if (/^[A-Z\d]{12}\d{2}$/.test(search.replace(/[.\-/\s]/g, '').toUpperCase())) {
        setPickerOpen(false);
        setNewCompany({ cnpj: search });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setEmails = (emails: ContactInput['emails']) => {
    if (emails.length && !emails.some((e) => e.is_primary)) emails[0]!.is_primary = true;
    form.setValue('emails', emails, { shouldDirty: true });
  };
  const setPhones = (phones: NonNullable<ContactInput['phones']>) => {
    if (phones.length && !phones.some((p) => p.is_primary)) phones[0]!.is_primary = true;
    form.setValue('phones', phones, { shouldDirty: true });
  };
  const save = async () => {
    setError('');
    setFieldErrors({});
    const parsed = contactSchema.safeParse(form.getValues());
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      throw Error('Revise os campos indicados.');
    }
    const result = await api<{ id: string }>('/contacts' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: parsed.data,
    });
    await Promise.all(
      ['contacts', 'contact', 'global-search', 'contact-history', 'contact-suggestions'].map(
        (key) => client.invalidateQueries({ queryKey: [key] }),
      ),
    );
    const saved = await api<ContactDetail>('/contacts/' + result.id);
    form.reset(saved);
    return saved;
  };
  const runSave = async (send = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await save();
      toast.success('Contato salvo.');
      if (send) {
        setConfirmSend(false);
        setSendContact(saved);
      } else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const savedContact = async () => {
    if (!id) return;
    setBusy(true);
    try {
      setSendContact(await api<ContactDetail>('/contacts/' + id));
      setConfirmSend(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-xs text-muted-foreground">Disponível para toda a empresa</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!id || busy}
          title={!id ? 'Salve o contato para enviar um e-mail.' : undefined}
          onClick={() => {
            if (dirty) setConfirmSend(true);
            else void savedContact();
          }}
        >
          <Send aria-hidden />
          Enviar novo e-mail
        </Button>
        {!id && (
          <p className="w-full text-xs text-muted-foreground">
            Salve o contato para enviar um e-mail.
          </p>
        )}
      </div>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void runSave();
        }}
      >
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <section className="space-y-3">
            <Label>Empresas (opcional)</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-between font-normal"
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
                className="max-h-[55dvh] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto overscroll-contain"
              >
                <Label htmlFor="contact-company-search">
                  Buscar CNPJ, razão social ou nome fantasia
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
                  <LoadingState />
                ) : options.error ? (
                  <ErrorState onRetry={() => void options.refetch()} />
                ) : !options.data?.items.length ? (
                  <p className="text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
                ) : (
                  options.data.items.map((company) => (
                    <label key={company.id} className="flex min-h-11 items-center gap-2 text-sm">
                      <Checkbox
                        checked={companies.some((c) => c.id === company.id)}
                        onCheckedChange={() => toggleCompany(company)}
                      />
                      <span className="min-w-0 break-words">
                        {company.name}
                        {company.trade_name ? ' · ' + company.trade_name : ''}
                        {company.cnpj ? ' · ' + company.cnpj : ''}
                      </span>
                    </label>
                  ))
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setPickerOpen(false);
                    setNewCompany({ cnpj: '' });
                  }}
                >
                  <Plus />
                  Nova empresa
                </Button>
                <Button type="button" className="w-full" onClick={() => setPickerOpen(false)}>
                  Concluir
                </Button>
              </PopoverContent>
            </Popover>
            <PrincipalChips
              items={companies.map((c) => ({
                key: c.id!,
                text: c.name,
                primary: !!c.is_primary,
                info: <CompanyInfo id={c.id!} name={c.name} />,
              }))}
              onPrimary={(key) =>
                form.setValue(
                  'companies',
                  companies.map((c) => ({ ...c, is_primary: c.id === key })),
                  { shouldDirty: true },
                )
              }
              onRemove={removeCompany}
            />
            <p className="text-sm text-muted-foreground">
              Selecione uma ou mais empresas. Use a estrela para definir a principal.
            </p>
            {fieldErrors.companies && (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.companies}
              </p>
            )}
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="contact-nickname">Meu apelido</Label>
              <Input
                id="contact-nickname"
                aria-describedby="contact-nickname-help"
                aria-invalid={!!fieldErrors.nickname}
                {...form.register('nickname')}
              />
              <p id="contact-nickname-help" className="text-xs text-muted-foreground">
                Visível apenas para você. Use para encontrar este contato nas buscas.
              </p>
              {fieldErrors.nickname && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldErrors.nickname}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <ChannelPicker
              kind="email"
              items={values.emails.map((e) => ({ value: e.email, primary: !!e.is_primary }))}
              error={fieldErrors.emails}
              onAdd={(email) =>
                setEmails([
                  ...values.emails,
                  { email, label: '', links: [], is_primary: !values.emails.length },
                ])
              }
              onEdit={(i, email) =>
                setEmails(values.emails.map((e, n) => (n === i ? { ...e, email } : e)))
              }
              onRemove={(i) => setEmails(values.emails.filter((_, n) => n !== i))}
              onPrimary={(i) =>
                setEmails(values.emails.map((e, n) => ({ ...e, is_primary: n === i })))
              }
            />
            <ChannelPicker
              kind="phone"
              items={(values.phones ?? []).map((p) => ({
                value: p.number,
                primary: !!p.is_primary,
                label: p.label,
              }))}
              error={fieldErrors.phones}
              onAdd={(number) =>
                setPhones([
                  ...(values.phones ?? []),
                  { number, label: '', is_primary: !values.phones?.length },
                ])
              }
              onEdit={(i, number) =>
                setPhones((values.phones ?? []).map((p, n) => (n === i ? { ...p, number } : p)))
              }
              onEditLabel={(i, label) =>
                setPhones((values.phones ?? []).map((p, n) => (n === i ? { ...p, label } : p)))
              }
              onRemove={(i) => setPhones((values.phones ?? []).filter((_, n) => n !== i))}
              onPrimary={(i) =>
                setPhones((values.phones ?? []).map((p, n) => ({ ...p, is_primary: n === i })))
              }
            />
          </div>
          <details className="rounded-md border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
              Observações
            </summary>
            <div className="space-y-2 pt-3">
              <Label htmlFor="contact-notes">Observações sobre o contato</Label>
              <Textarea id="contact-notes" {...form.register('notes')} />
            </div>
          </details>
          {id && (
            <details
              className="rounded-md border p-3"
              onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
            >
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
                <History aria-hidden className="size-4" />
                Histórico de e-mails
              </summary>
              {historyOpen && <ContactHistory contact={{ ...initial, id } as ContactDetail} />}
            </details>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t p-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar contato'}</Button>
        </footer>
      </form>
      {newCompany && (
        <CompanyEditorDialog
          cnpj={newCompany.cnpj}
          onClose={() => setNewCompany(null)}
          onSaved={selectCompany}
        />
      )}
      {sendContact && (
        <ContactSendDialog contact={sendContact} onClose={() => setSendContact(null)} />
      )}
      {confirmSend && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !busy) setConfirmSend(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Alterações pendentes</DialogTitle>
              <DialogDescription>
                Escolha quais dados do contato serão usados para abrir a mensagem.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmSend(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void savedContact()}
              >
                Continuar com dados salvos
              </Button>
              <Button type="button" disabled={busy} onClick={() => void runSave(true)}>
                Salvar e continuar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
