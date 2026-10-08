import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contactSchema,
  contactAddressSchema,
  type ContactInput,
  type ContactDetail,
} from '@apmail/shared';
import { Send, History, Plus, Trash2 } from 'lucide-react';
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
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { DirectoryHeader, ChannelPicker, useDirectorySearch } from './directory-fields';
import { ContactSendDialog } from './contact-send';
import { ContactHistory } from './contact-history';
function SuggestionInput({
  field,
  label,
  value,
  onChange,
}: {
  field: 'company' | 'job_title';
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    tenant = useTenantId(),
    user = useQuery(meQuery).data?.user.id,
    search = useDirectorySearch(value);
  const options = useQuery({
    queryKey: ['contact-autocomplete', tenant, user, field, search],
    queryFn: ({ signal }) =>
      api<{ items: string[] }>('/contacts/suggestions?' + new URLSearchParams({ field, search }), {
        signal,
      }),
  });
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        list={id + '-options'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id + '-options'}>
        {options.data?.items.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </div>
  );
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
  const tenant = useTenantId(),
    user = useQuery(meQuery).data?.user.id;
  const q = useQuery({
    queryKey: ['contact', tenant, user, id],
    queryFn: ({ signal }) => api<ContactDetail>('/contacts/' + id, { signal }),
    enabled: !!id,
  });
  const defaults: ContactInput = {
    name,
    nickname: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    prefix: '',
    suffix: '',
    company: '',
    job_title: '',
    department: '',
    office: '',
    website: '',
    birthday: '',
    phone: '',
    phones: [],
    addresses: [],
    notes: '',
    emails: email ? [{ email, label: '', is_primary: true }] : [],
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-5xl">
        <DirectoryHeader
          title={id ? 'Editar contato' : 'Novo contato'}
          description="Organize os dados e canais do contato. Informe o nome completo e ao menos um e-mail ou telefone."
        />
        {id && q.isLoading ? (
          <LoadingState />
        ) : id && q.error ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          <ContactForm key={id ?? 'new'} id={id} initial={q.data ?? defaults} onClose={onClose} />
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
  initial: ContactInput | ContactDetail;
  onClose: () => void;
}) {
  const form = useForm<ContactInput>({
      defaultValues: {
        ...initial,
        expected_version: 'version' in initial ? initial.version : undefined,
      },
    }),
    values = useWatch({ control: form.control, compute: () => form.getValues() }),
    client = useQueryClient(),
    tenant = useTenantId();
  const mode = useQuery({
    queryKey: ['contact-mode', tenant],
    queryFn: () => api<{ mode: 'personal' | 'tenant' }>('/contacts/mode'),
  });
  const timezone = useQuery(meQuery).data?.preferences.timezone;
  const [error, setError] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [send, setSend] = useState<ContactDetail | null>(null),
    [confirmSend, setConfirmSend] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
  const [lookupAddress, setLookupAddress] = useState<number | null>(null);
  const set = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) =>
    form.setValue(key, value as never, { shouldDirty: true });
  const lookupCep = async (index: number) => {
    const address = form.getValues('addresses')[index];
    if (!address || lookupAddress !== null) return;
    const cep = address.cep.replace(/\D/g, '');
    if (cep.length !== 8) {
      toast.error('Informe um CEP com 8 números.');
      return;
    }
    setLookupAddress(index);
    try {
      const response = await api<{ address: Partial<ContactInput['addresses'][number]> }>(
        '/contacts/lookup/cep/' + cep,
      );
      const current = form.getValues('addresses');
      set(
        'addresses',
        current.map((value, position) =>
          position === index
            ? {
                ...value,
                ...Object.fromEntries(
                  Object.entries(response.address).filter(([, field]) => !!field),
                ),
                number: value.number,
                complement: value.complement || response.address.complement || '',
                type: value.type,
              }
            : value,
        ),
      );
      toast.success('Endereço consultado. Revise os dados antes de salvar.');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLookupAddress(null);
    }
  };
  const save = async () => {
    setErrors({});
    const parsed = contactSchema.safeParse(form.getValues());
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      throw Error('Revise os campos indicados.');
    }
    if (id) {
      const { nickname: previousNick, expected_version: previousVersion, ...previous } = initial;
      void previousNick;
      void previousVersion;
      const { nickname: nextNick, expected_version: nextVersion, ...next } = parsed.data;
      void nextVersion;
      const keys = Object.keys(next) as (keyof typeof next)[];
      if (keys.every((key) => JSON.stringify(next[key]) === JSON.stringify(previous[key]))) {
        await api('/contacts/' + id + '/nickname', {
          method: 'PATCH',
          body: { nickname: nextNick ?? '' },
        });
        const saved = await api<ContactDetail>('/contacts/' + id);
        form.reset({ ...saved, expected_version: saved.version });
        await client.invalidateQueries({ queryKey: ['contacts'] });
        return saved;
      }
    }
    const result = await api<{ id: string }>('/contacts' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: parsed.data,
    });
    await Promise.all(
      [
        'contacts',
        'contact',
        'global-search',
        'contact-suggestions',
        'contact-history',
        'contact-autocomplete',
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
    const saved = await api<ContactDetail>('/contacts/' + result.id);
    form.reset({ ...saved, expected_version: saved.version });
    return saved;
  };
  const run = async (sendAfter = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await save();
      toast.success('Contato salvo.');
      if (sendAfter) {
        setConfirmSend(false);
        setSend(saved);
      } else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sendSaved = async () => {
    if (!id) return;
    setBusy(true);
    try {
      setSend(await api<ContactDetail>('/contacts/' + id));
      setConfirmSend(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof ContactInput, label: string, type = 'text') => (
    <div key={key} className="space-y-2">
      <Label htmlFor={'contact-' + key}>{label}</Label>
      <Input
        id={'contact-' + key}
        type={type}
        aria-invalid={!!errors[key]}
        {...form.register(key)}
      />
      {errors[key] && (
        <p role="alert" className="text-sm text-destructive">
          {errors[key]}
        </p>
      )}
    </div>
  );
  const scope = 'scope' in initial ? initial.scope : mode.data?.mode;
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-xs text-muted-foreground">
          {scope === 'personal'
            ? 'Individual: visível somente para você'
            : 'Global: compartilhado com a empresa'}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!id || busy || !values.emails.length}
          onClick={() => {
            if (form.formState.isDirty) setConfirmSend(true);
            else void sendSaved();
          }}
        >
          <Send aria-hidden />
          Enviar novo e-mail
        </Button>
        {!values.emails.length && (
          <p className="w-full text-xs text-muted-foreground">
            Cadastre um e-mail para enviar mensagens.
          </p>
        )}
      </div>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('name', 'Nome completo *')} {field('nickname', 'Meu apelido (privado)')}
            <SuggestionInput
              field="company"
              label="Empresa"
              value={values.company}
              onChange={(v) => set('company', v)}
            />
            <SuggestionInput
              field="job_title"
              label="Cargo"
              value={values.job_title}
              onChange={(v) => set('job_title', v)}
            />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <ChannelPicker
              kind="email"
              items={values.emails.map((e) => ({
                value: e.email,
                label: e.label,
                primary: !!e.is_primary,
              }))}
              error={Object.entries(errors)
                .filter(([key]) => key.startsWith('emails'))
                .map(([, v]) => v)
                .join(' ')}
              onAdd={(email) =>
                set('emails', [
                  ...values.emails,
                  { email, label: '', is_primary: !values.emails.length },
                ])
              }
              onEdit={(i, email) =>
                set(
                  'emails',
                  values.emails.map((e, n) => (n === i ? { ...e, email } : e)),
                )
              }
              onEditLabel={(i, label) =>
                set(
                  'emails',
                  values.emails.map((e, n) => (n === i ? { ...e, label } : e)),
                )
              }
              onRemove={(i) =>
                set(
                  'emails',
                  values.emails.filter((_, n) => n !== i),
                )
              }
              onPrimary={(i) =>
                set(
                  'emails',
                  values.emails.map((e, n) => ({ ...e, is_primary: n === i })),
                )
              }
            />
            <ChannelPicker
              kind="phone"
              items={values.phones.map((p) => ({
                value: p.number,
                label: p.label,
                primary: !!p.is_primary,
              }))}
              error={Object.entries(errors)
                .filter(([key]) => key.startsWith('phones'))
                .map(([, v]) => v)
                .join(' ')}
              onAdd={(number) =>
                set('phones', [
                  ...values.phones,
                  { number, label: '', is_primary: !values.phones.length },
                ])
              }
              onEdit={(i, number) =>
                set(
                  'phones',
                  values.phones.map((p, n) => (n === i ? { ...p, number } : p)),
                )
              }
              onEditLabel={(i, label) =>
                set(
                  'phones',
                  values.phones.map((p, n) => (n === i ? { ...p, label } : p)),
                )
              }
              onRemove={(i) =>
                set(
                  'phones',
                  values.phones.filter((_, n) => n !== i),
                )
              }
              onPrimary={(i) =>
                set(
                  'phones',
                  values.phones.map((p, n) => ({ ...p, is_primary: n === i })),
                )
              }
            />
          </div>
          <details className="rounded-md border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
              Dados complementares (Outlook)
            </summary>
            <div className="grid gap-4 pt-3 sm:grid-cols-2">
              {field('first_name', 'Nome')}
              {field('middle_name', 'Nome do meio')}
              {field('last_name', 'Sobrenome')}
              {field('prefix', 'Prefixo')}
              {field('suffix', 'Sufixo')}
              {field('department', 'Departamento')}
              {field('office', 'Escritório')}
              {field('website', 'Site', 'url')}
              {field('birthday', 'Aniversário', 'date')}
            </div>
          </details>
          <details className="rounded-md border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
              Endereços opcionais ({values.addresses.length})
            </summary>
            <div className="space-y-4 pt-3">
              {values.addresses.map((address, index) => (
                <fieldset key={index} className="space-y-3 rounded-md border p-3">
                  <legend className="text-sm">Endereço {index + 1}</legend>
                  <Label htmlFor={'address-type-' + index}>Tipo</Label>
                  <select
                    id={'address-type-' + index}
                    className="h-11 w-full rounded-md border bg-background px-3"
                    value={address.type}
                    onChange={(e) =>
                      set(
                        'addresses',
                        values.addresses.map((a, n) =>
                          n === index ? { ...a, type: e.target.value as typeof a.type } : a,
                        ),
                      )
                    }
                  >
                    <option value="home">Residencial</option>
                    <option value="work">Comercial</option>
                    <option value="other">Outro</option>
                  </select>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries({
                      cep: 'CEP',
                      street: 'Rua',
                      number: 'Número',
                      complement: 'Complemento',
                      district: 'Bairro',
                      city: 'Cidade',
                      state: 'Estado',
                      country: 'País',
                    }).map(([key, label]) => (
                      <div key={key} className="space-y-2">
                        <Label htmlFor={`address-${index}-${key}`}>{label}</Label>
                        <Input
                          id={`address-${index}-${key}`}
                          {...form.register(`addresses.${index}.${key}` as 'addresses.0.city')}
                          onKeyDown={(event) => {
                            if (key === 'cep' && event.key === 'Enter') {
                              event.preventDefault();
                              void lookupCep(index);
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={lookupAddress !== null}
                    onClick={() => void lookupCep(index)}
                  >
                    {lookupAddress === index ? 'Consultando CEP…' : 'Consultar CEP (Enter)'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      set(
                        'addresses',
                        values.addresses.filter((_, n) => n !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                    Remover endereço
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  set('addresses', [...values.addresses, contactAddressSchema.parse({})])
                }
              >
                <Plus aria-hidden />
                Adicionar endereço
              </Button>
            </div>
          </details>
          <div className="space-y-2">
            <Label htmlFor="contact-notes">Observações</Label>
            <Textarea id="contact-notes" {...form.register('notes')} />
          </div>
          {'created_at' in initial && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
              <p>
                Criado por {initial.created_by_name} em{' '}
                {new Date(initial.created_at).toLocaleString('pt-BR', { timeZone: timezone })}
              </p>
              <p>
                Última alteração por {initial.updated_by_name} em{' '}
                {new Date(initial.updated_at).toLocaleString('pt-BR', { timeZone: timezone })}
              </p>
            </div>
          )}
          {id && (
            <details
              className="rounded-md border p-3"
              onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
            >
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 text-sm font-medium">
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
        <footer className="flex shrink-0 justify-end gap-3 border-t p-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar contato'}</Button>
        </footer>
      </form>
      {send && <ContactSendDialog contact={send} onClose={() => setSend(null)} />}
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
                Escolha quais dados serão usados para enviar a mensagem.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmSend(false)}>
                Cancelar
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void sendSaved()}>
                Usar dados salvos
              </Button>
              <Button disabled={busy} onClick={() => void run(true)}>
                Salvar e continuar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
