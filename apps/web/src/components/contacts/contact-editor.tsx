import { useState } from 'react';
import { useForm, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{id ? 'Editar contato' : 'Novo contato'}</DialogTitle>
          <DialogDescription>
            Um contato pode ter vários e-mails. Empresas e endereços pertencem ao e-mail
            selecionado.
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
              q.data ?? { name, phone: '', notes: '', emails: [{ email, label: '', links: [] }] }
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
  const form = useForm<ContactInput>({ defaultValues: initial });
  const emails = useFieldArray({ control: form.control, name: 'emails' });
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
  const contacts = useQuery({
    queryKey: ['contact-link-options', tenantId, search],
    queryFn: () =>
      api<{ items: { id: string; name: string; emails: string[] }[] }>(
        '/contacts?' + new URLSearchParams({ search, pageSize: '10' }),
      ),
    enabled: !id && !!search,
  });
  const fields = [
    ['name', 'Nome'],
    ['phone', 'Telefone'],
    ['notes', 'Observações'],
  ] as const;
  const watched = useWatch({ control: form.control }),
    visibility = watched.visibility ?? 'all';
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        setError('');
        try {
          const body = contactSchema.parse(values);
          if (!mayControl) {
            delete body.visibility;
            delete body.mailbox_ids;
          }
          if (linkId && !id) {
            const existing = await api<ContactDetail>('/contacts/' + linkId);
            const merged = { ...existing, emails: [...existing.emails, ...body.emails] };
            if (!mayControl) {
              delete (merged as ContactInput).visibility;
              delete (merged as ContactInput).mailbox_ids;
            }
            await api('/contacts/' + linkId, { method: 'PUT', body: contactSchema.parse(merged) });
          } else
            await api(id ? '/contacts/' + id : '/contacts', { method: id ? 'PUT' : 'POST', body });
          await client.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).startsWith('contact'),
          });
          toast.success('Contato salvo.');
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
        }
      })}
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
      {!linkId &&
        fields.map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={'contact-' + key}>{label}</Label>
            <Input
              id={'contact-' + key}
              {...form.register(key)}
              aria-invalid={!!form.formState.errors[key]}
            />
          </div>
        ))}
      {emails.fields.map((entry, index) => (
        <fieldset key={entry.id} className="space-y-3 rounded-lg border p-4">
          <legend>E-mail {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={'contact-email-' + entry.id}>Endereço de e-mail</Label>
              <Input
                id={'contact-email-' + entry.id}
                type="email"
                {...form.register(`emails.${index}.email`)}
              />
            </div>
            <div>
              <Label htmlFor={'contact-label-' + entry.id}>Identificação</Label>
              <Input id={'contact-label-' + entry.id} {...form.register(`emails.${index}.label`)} />
            </div>
          </div>
          <EmailLinks index={index} form={form} />
          <Button
            type="button"
            variant="ghost"
            disabled={emails.fields.length === 1}
            onClick={() => emails.remove(index)}
          >
            Remover e-mail
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => emails.append({ email: '', label: '', links: [] })}
      >
        Adicionar e-mail
      </Button>
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
      <div className="flex justify-end gap-2">
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
function EmailLinks({ index, form }: { index: number; form: UseFormReturn<ContactInput> }) {
  const links = useFieldArray({ control: form.control, name: `emails.${index}.links` });
  const watchedLinks = useWatch({ control: form.control, name: `emails.${index}.links` });
  const [busy, setBusy] = useState<string | null>(null);
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
    <div className="space-y-3">
      {links.fields.map((link, li) => {
        const key = `emails.${index}.links.${li}` as const,
          current = watchedLinks?.[li];
        return (
          <fieldset key={link.id} className="space-y-3 rounded-md border p-3">
            <legend>Empresa / endereço {li + 1}</legend>
            {current?.company && (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor={link.id + 'cnpj'}>CNPJ</Label>
                    <Input id={link.id + 'cnpj'} {...form.register(`${key}.company.cnpj`)} />
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
                    <Label htmlFor={link.id + field}>{i ? 'Nome fantasia' : 'Razão social'}</Label>
                    <Input id={link.id + field} {...form.register(`${key}.company.${field}`)} />
                  </div>
                ))}
              </>
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
            <Button type="button" variant="ghost" onClick={() => links.remove(li)}>
              Remover vínculo
            </Button>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            links.append({
              label: '',
              company: { name: '', trade_name: '', cnpj: '' },
              address: { ...emptyAddress },
            })
          }
        >
          Adicionar empresa e endereço
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => links.append({ label: '', company: null, address: { ...emptyAddress } })}
        >
          Adicionar endereço por CEP
        </Button>
      </div>
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
