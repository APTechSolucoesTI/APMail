import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { UserPlus, Link2, ArrowLeft, Search, Check } from 'lucide-react';
import { contactSchema, uniqueAddresses, type Address } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, useUserId, useAccess } from '@/lib/auth';
import { invalidateContactResolution } from '@/lib/contact-resolution';
import { useDirectorySearch } from './directory-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';

type ContactOption = { id: string; name: string; emails: string[]; scope: string; company: string };
/** One dialog for inbox and post-delivery, with sequential recipients and no overlays. */
export function ContactAssociationDialog({
  addresses,
  afterSend = false,
  onClose,
}: {
  addresses: Address[];
  afterSend?: boolean;
  onClose: () => void;
}) {
  const canRead = useAccess('contacts'),
    canCreate = useAccess('contacts.create'),
    canEdit = useAccess('contacts.edit');
  const items = uniqueAddresses(addresses),
    [index, setIndex] = useState(0);
  const [step, setStep] = useState<'offer' | 'choose' | 'create' | 'link'>(
    afterSend ? 'offer' : 'choose',
  );
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const tenant = useTenantId(),
    user = useUserId(),
    client = useQueryClient(),
    id = useId(),
    term = useDirectorySearch(search);
  const address = items[index];
  const form = useForm<{ name: string; company: string; job_title: string }>({
    defaultValues: { name: address?.name || '', company: '', job_title: '' },
  });
  const contacts = useQuery({
    queryKey: ['contacts', 'association', tenant, user, term],
    enabled: canRead && canEdit && step === 'link',
    queryFn: ({ signal }) =>
      api<{ items: ContactOption[]; total: number }>(
        '/contacts?' + new URLSearchParams({ search: term, pageSize: '20' }),
        { signal },
      ),
  });
  const advance = async () => {
    setError('');
    setSelected(null);
    setSearch('');
    const rest = items.slice(index + 1);
    if (!rest.length) {
      onClose();
      return;
    }
    const { contacts } = await api<{ contacts: Record<string, unknown> }>('/contacts/resolve', {
      method: 'POST',
      body: { emails: rest.map((a) => a.address) },
    });
    const offset = rest.findIndex((a) => !contacts[a.address]);
    if (offset < 0) {
      onClose();
      return;
    }
    const next = index + 1 + offset;
    setIndex(next);
    setStep('choose');
    form.reset({ name: items[next]!.name, company: '', job_title: '' });
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy || !address || !canRead || (step === 'create' ? !canCreate : !canEdit)) return;
    setBusy(true);
    setError('');
    try {
      const current = await api<{ contacts: Record<string, unknown> }>('/contacts/resolve', {
        method: 'POST',
        body: { emails: [address.address] },
      });
      if (current.contacts[address.address]) {
        await invalidateContactResolution(client);
        toast.info('Este endereço já está associado a um contato.');
        await advance();
        return;
      }
      await action();
      await invalidateContactResolution(client);
      toast.success(success);
      await advance();
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : 'Não foi possível salvar o contato.') +
          (afterSend ? ' O e-mail já foi enviado.' : ''),
      );
    } finally {
      setBusy(false);
    }
  };
  if (!address || !canRead || (!canCreate && !canEdit)) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        data-contact-association="true"
        className="flex max-h-[90dvh] flex-col sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {step === 'offer'
              ? 'Destinatário não cadastrado'
              : step === 'create'
                ? 'Criar novo contato'
                : step === 'link'
                  ? 'Vincular a contato existente'
                  : 'Como deseja adicionar este endereço?'}
          </DialogTitle>
          <DialogDescription>
            {step === 'offer'
              ? `Identificamos que o endereço ${address.address} ainda não está associado a nenhum contato. Deseja adicioná-lo aos seus contatos?`
              : 'Cadastre uma pessoa ou adicione este endereço a um contato da sua agenda.'}
          </DialogDescription>
        </DialogHeader>
        {step !== 'offer' && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="break-all text-sm font-medium">{address.address}</p>
            {items.length > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Endereço {index + 1} de {items.length}
              </p>
            )}
          </div>
        )}
        {step === 'offer' ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Não, obrigado
            </Button>
            <Button onClick={() => setStep('choose')}>Sim, adicionar</Button>
          </div>
        ) : step === 'choose' ? (
          <div className="space-y-3">
            {canCreate && (
              <Button
                variant="outline"
                className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal p-4 text-left"
                onClick={() => setStep('create')}
              >
                <UserPlus className="size-5 shrink-0" />
                <span>
                  <span className="block font-semibold">Criar novo contato</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Usar os dados da mensagem e completar a ficha.
                  </span>
                </span>
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal p-4 text-left"
                onClick={() => setStep('link')}
              >
                <Link2 className="size-5 shrink-0" />
                <span>
                  <span className="block font-semibold">Vincular a contato existente</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Preservar todos os endereços já cadastrados.
                  </span>
                </span>
              </Button>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {items.length > 1 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await advance();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Pular endereço
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>
                Encerrar
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : step === 'create' ? (
          <form
            className="space-y-4 overflow-y-auto"
            onSubmit={form.handleSubmit((values) =>
              run(async () => {
                const result = contactSchema.safeParse({
                  ...values,
                  emails: [{ email: address.address, label: '', is_primary: true }],
                });
                if (!result.success) {
                  for (const issue of result.error.issues) {
                    if (issue.path[0] === 'name') form.setError('name', { message: issue.message });
                  }
                  throw new Error('Revise os dados do contato.');
                }
                await api('/contacts/from-message', { method: 'POST', body: result.data });
              }, 'Contato criado.'),
            )}
          >
            <div className="space-y-2">
              <Label htmlFor={id + '-name'}>Nome completo</Label>
              <Input
                id={id + '-name'}
                autoFocus
                disabled={busy}
                {...form.register('name', {
                  required: 'Informe o nome.',
                  minLength: { value: 2, message: 'Use ao menos 2 caracteres.' },
                })}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={id + '-name-error'}
              />
              <p id={id + '-name-error'} role="alert" className="text-xs text-destructive">
                {form.formState.errors.name?.message}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={id + '-email'}>E-mail</Label>
              <Input id={id + '-email'} type="email" value={address.address} readOnly />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={id + '-company'}>Empresa (opcional)</Label>
                <Input id={id + '-company'} disabled={busy} {...form.register('company')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={id + '-job'}>Cargo (opcional)</Label>
                <Input id={id + '-job'} disabled={busy} {...form.register('job_title')} />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-between gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep('choose');
                  setError('');
                }}
              >
                <ArrowLeft />
                Voltar
              </Button>
              <Button disabled={busy || !canCreate}>{busy ? 'Salvando…' : 'Salvar contato'}</Button>
            </div>
          </form>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <Label htmlFor={id + '-search'}>Buscar por nome ou e-mail</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
              <Input
                className="pl-9"
                id={id + '-search'}
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
              />
            </div>
            <div
              className="max-h-64 min-h-24 overflow-y-auto rounded-md border"
              role="radiogroup"
              aria-label="Contatos encontrados"
            >
              {contacts.isLoading || term !== search ? (
                <LoadingState />
              ) : contacts.error ? (
                <ErrorState onRetry={() => void contacts.refetch()} />
              ) : !contacts.data?.items.length ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Nenhum contato encontrado.{' '}
                  {canCreate ? 'Ajuste a busca ou crie um novo contato.' : 'Ajuste a busca.'}
                </p>
              ) : (
                contacts.data.items.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-0 hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name={id + '-contact'}
                      value={contact.id}
                      checked={selected === contact.id}
                      onChange={() => setSelected(contact.id)}
                      className="mt-1 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{contact.name}</span>
                      <span className="block break-all text-xs text-muted-foreground">
                        {contact.emails.join(' · ') || 'Sem e-mail'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {contact.scope === 'personal' ? 'Agenda individual' : 'Agenda global'}
                        {contact.company ? ' · ' + contact.company : ''}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {contacts.data && contacts.data.total > 20 && (
              <p className="text-xs text-muted-foreground">
                20 de {contacts.data.total} contatos. Refine a busca.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-between gap-2 border-t pt-4">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep('choose');
                  setError('');
                }}
              >
                <ArrowLeft />
                Voltar
              </Button>
              <Button
                disabled={!selected || busy || !canEdit}
                onClick={() =>
                  void run(
                    () =>
                      api('/contacts/' + selected + '/emails', {
                        method: 'POST',
                        body: { email: address.address },
                      }),
                    'Endereço vinculado.',
                  )
                }
              >
                <Check />
                {busy ? 'Vinculando…' : 'Confirmar vínculo'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
