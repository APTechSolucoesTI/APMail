import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { contactSchema, type Address, uniqueAddresses } from '@apmail/shared';
import { ArrowLeft, ChevronLeft, ChevronRight, MailPlus, Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAccess, useTenantId, useUserId } from '@/lib/auth';
import { invalidateContactResolution } from '@/lib/contact-resolution';
import { useDirectorySearch } from '@/components/contacts/directory-fields';
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
import { LoadingState, ErrorState, NoPermissionState } from '@/components/data/data-state';

type ContactOption = { id: string; name: string; company: string; scope: string; emails: string[] };
const addressForm = z.object({
  name: z.string().trim().min(2, 'Informe ao menos 2 caracteres.'),
  email: z.email('Informe um e-mail válido.').trim().toLowerCase(),
});

export function RecipientPicker({
  label,
  value,
  initialEmail,
  onSelect,
  onClose,
}: {
  label: string;
  value: Address[];
  initialEmail: string;
  onSelect: (addresses: Address[]) => void;
  onClose: () => void;
}) {
  const canRead = useAccess('contacts'),
    canCreate = useAccess('contacts.create'),
    canEdit = useAccess('contacts.edit');
  const tenant = useTenantId(),
    user = useUserId(),
    client = useQueryClient(),
    id = useId();
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const term = useDirectorySearch(search);
  const [selected, setSelected] = useState<Address[]>([]);
  const [editor, setEditor] = useState<'new' | ContactOption | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const form = useForm<z.infer<typeof addressForm>>({
    resolver: zodResolver(addressForm),
    defaultValues: {
      name: '',
      email: z.email().safeParse(initialEmail.trim()).success ? initialEmail.trim() : '',
    },
  });
  const contacts = useQuery({
    queryKey: ['contacts', 'recipient-picker', tenant, user, term, page],
    enabled: canRead,
    queryFn: ({ signal }) =>
      api<{ items: ContactOption[]; total: number }>(
        '/contacts?' + new URLSearchParams({ search: term, page: String(page), pageSize: '20' }),
        { signal },
      ),
  });
  const selectAddresses = (addresses: Address[]) => {
    onSelect(uniqueAddresses([...value, ...addresses]));
    onClose();
  };
  const begin = (contact: 'new' | ContactOption) => {
    setError('');
    setEditor(contact);
    form.reset({
      name: contact === 'new' ? '' : contact.name,
      email: z.email().safeParse(initialEmail.trim()).success ? initialEmail.trim() : '',
    });
  };
  const save = form.handleSubmit(async (values) => {
    if (busy || !canRead || !editor || (editor === 'new' ? !canCreate : !canEdit)) return;
    setBusy(true);
    setError('');
    try {
      if (editor === 'new') {
        const body = contactSchema.parse({
          name: values.name,
          emails: [{ email: values.email, label: '', is_primary: true }],
        });
        await api('/contacts/from-message', { method: 'POST', body });
      } else {
        await api('/contacts/' + editor.id + '/emails', {
          method: 'POST',
          body: { email: values.email },
        });
      }
      await invalidateContactResolution(client);
      toast.success(editor === 'new' ? 'Contato criado.' : 'Endereço adicionado ao contato.');
      selectAddresses([...selected, { address: values.email, name: values.name }]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editor
              ? editor === 'new'
                ? 'Novo contato'
                : 'Adicionar e-mail ao contato'
              : 'Selecionar destinatários — ' + label}
          </DialogTitle>
          <DialogDescription>
            {editor
              ? 'O endereço salvo será usado nesta mensagem.'
              : 'Busque na sua agenda e selecione um ou mais endereços por contato.'}
          </DialogDescription>
        </DialogHeader>
        {!canRead ? (
          <NoPermissionState />
        ) : editor ? (
          <form onSubmit={(event) => void save(event)} className="space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor={id + '-name'}>Nome completo</Label>
              <Input
                id={id + '-name'}
                {...form.register('name')}
                readOnly={editor !== 'new'}
                disabled={busy}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={id + '-name-error'}
              />
              <p id={id + '-name-error'} className="text-xs text-destructive">
                {form.formState.errors.name?.message}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={id + '-email'}>E-mail do contato</Label>
              <Input
                id={id + '-email'}
                type="email"
                autoFocus
                {...form.register('email')}
                disabled={busy}
                aria-invalid={!!form.formState.errors.email}
                aria-describedby={id + '-email-error'}
              />
              <p id={id + '-email-error'} className="text-xs text-destructive">
                {form.formState.errors.email?.message}
              </p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditor(null);
                  setError('');
                }}
              >
                <ArrowLeft /> Voltar à agenda
              </Button>
              <Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar e usar endereço'}</Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor={id + '-search'}>Buscar nome, empresa ou e-mail</Label>
                <div className="relative">
                  <Search
                    aria-hidden
                    className="absolute left-3 top-3 size-4 text-muted-foreground"
                  />
                  <Input
                    id={id + '-search'}
                    className="pl-9"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
              {canCreate && (
                <Button variant="outline" onClick={() => begin('new')}>
                  <UserPlus /> Novo contato
                </Button>
              )}
            </div>
            <div
              className="min-h-24 overflow-y-auto rounded-md border"
              aria-label="Endereços da agenda"
            >
              {contacts.isPending || search !== term ? (
                <LoadingState />
              ) : contacts.error ? (
                <ErrorState onRetry={() => void contacts.refetch()} />
              ) : !contacts.data?.items.length ? (
                <p role="status" className="p-4 text-sm text-muted-foreground">
                  {search
                    ? 'Nenhum contato encontrado. Ajuste a busca.'
                    : 'Sua agenda ainda não possui contatos.'}
                </p>
              ) : (
                contacts.data.items.map((contact) => (
                  <section key={contact.id} className="border-b p-3 last:border-0">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-semibold">{contact.name}</h3>
                        <p className="break-words text-xs text-muted-foreground">
                          {contact.scope === 'personal' ? 'Agenda individual' : 'Agenda global'}
                          {contact.company ? ' · ' + contact.company : ''}
                        </p>
                      </div>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={'Adicionar e-mail a ' + contact.name}
                          title="Adicionar e-mail ao contato"
                          onClick={() => begin(contact)}
                        >
                          <MailPlus />
                        </Button>
                      )}
                    </div>
                    {!contact.emails.length && (
                      <p className="text-xs text-muted-foreground">Sem e-mail cadastrado</p>
                    )}
                    {contact.emails.map((email) => {
                      const included = value.some(
                        (address) => address.address.toLowerCase() === email.toLowerCase(),
                      );
                      const checked =
                        included ||
                        selected.some(
                          (address) => address.address.toLowerCase() === email.toLowerCase(),
                        );
                      return (
                        <label
                          key={email}
                          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-primary"
                            checked={checked}
                            disabled={included}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? uniqueAddresses([
                                      ...current,
                                      { address: email, name: contact.name },
                                    ])
                                  : current.filter(
                                      (address) =>
                                        address.address.toLowerCase() !== email.toLowerCase(),
                                    ),
                              )
                            }
                          />
                          <span className="break-all text-sm">
                            {email}
                            {included ? ' (já adicionado)' : ''}
                          </span>
                        </label>
                      );
                    })}
                  </section>
                ))
              )}
            </div>
            <nav
              aria-label="Paginação da agenda"
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
            >
              <span>
                {contacts.data?.total ?? 0} contatos · Página {page} de{' '}
                {Math.max(1, Math.ceil((contacts.data?.total ?? 0) / 20))}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Página anterior de contatos"
                  disabled={page === 1 || contacts.isFetching}
                  onClick={() => setPage((current) => current - 1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Próxima página de contatos"
                  disabled={page * 20 >= (contacts.data?.total ?? 0) || contacts.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </nav>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button disabled={!selected.length} onClick={() => selectAddresses(selected)}>
                Adicionar destinatários ({selected.length})
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
