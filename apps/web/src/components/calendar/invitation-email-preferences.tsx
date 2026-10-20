import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Mail, RotateCcw } from 'lucide-react';
import {
  DEFAULT_INVITATION_MESSAGE,
  invitationEmailPreferencesSchema,
  type InvitationEmailPreferences,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, canMailbox, type Mailbox } from '@/lib/auth';
import type { Signature } from '@/lib/outbox';
import { signaturePreview } from '@/lib/signature';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function InvitationEmailSettings({ className }: { className?: string } = {}) {
  const tenant = useTenantId();
  const preferences = useQuery({
    queryKey: ['invitation-email-preferences', tenant],
    queryFn: () => api<InvitationEmailPreferences>('/calendar/email-preferences'),
  });
  const signatures = useQuery({
    queryKey: ['signatures', tenant],
    queryFn: () => api<Signature[]>('/signatures'),
  });
  const mailboxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  if (preferences.isPending || signatures.isPending || mailboxes.isPending)
    return (
      <section
        role="status"
        className={cn(
          'max-w-2xl rounded-lg border bg-card p-4 text-sm text-muted-foreground',
          className,
        )}
      >
        Carregando preferências de convites…
      </section>
    );
  if (preferences.isError || signatures.isError || mailboxes.isError)
    return (
      <section className={cn('max-w-2xl space-y-3 rounded-lg border bg-card p-4', className)}>
        <p role="alert" className="text-sm">
          Não foi possível carregar as preferências de convites.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void preferences.refetch();
            void signatures.refetch();
            void mailboxes.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </section>
    );
  return (
    <InvitationEmailForm
      key={tenant}
      initial={preferences.data}
      signatures={signatures.data}
      mailboxes={mailboxes.data}
      className={className}
    />
  );
}

function InvitationEmailForm({
  initial,
  signatures,
  mailboxes,
  className,
}: {
  initial: InvitationEmailPreferences;
  signatures: Signature[];
  mailboxes: Mailbox[];
  className?: string;
}) {
  const tenant = useTenantId(),
    client = useQueryClient();
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const field =
    'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const selected = signatures.find((s) => s.id === form.signature_id);
  const signatureValue =
    form.signature_mode === 'selected' ? (form.signature_id ?? '') : form.signature_mode;
  return (
    <section className={cn('max-w-2xl rounded-lg border bg-card p-4', className)}>
      <div className="mb-4 flex items-start gap-3">
        <Mail className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-base font-semibold">E-mail padrão de convite</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Defina uma vez. Ao convidar participantes pela agenda, o APMail prepara e envia o e-mail
            automaticamente.
          </p>
        </div>
      </div>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError('');
          const parsed = invitationEmailPreferencesSchema.safeParse(form);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
            return;
          }
          setBusy(true);
          try {
            const saved = await api<InvitationEmailPreferences>('/calendar/email-preferences', {
              method: 'PUT',
              body: parsed.data,
            });
            client.setQueryData(['invitation-email-preferences', tenant], saved);
            setForm(saved);
            toast.success('Padrão de convites salvo.');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Não foi possível salvar. Tente novamente.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="invitation-mailbox">Conta padrão para enviar convites</Label>
          <select
            id="invitation-mailbox"
            className={field}
            disabled={busy}
            value={form.mailbox_id ?? ''}
            onChange={(e) => setForm({ ...form, mailbox_id: e.target.value || null })}
          >
            <option value="">Selecionar na reunião</option>
            {mailboxes
              .filter((b) => b.status === 'active' && canMailbox(b, 'send'))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.email_address}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Preenchida automaticamente nas novas reuniões. Você pode trocar a conta antes de enviar.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="invitation-message">Texto do convite</Label>
          <Textarea
            id="invitation-message"
            value={form.message_template}
            disabled={busy}
            maxLength={10000}
            rows={7}
            required
            aria-describedby="invitation-message-help"
            onChange={(e) => setForm({ ...form, message_template: e.target.value })}
          />
          <p id="invitation-message-help" className="text-xs leading-relaxed text-muted-foreground">
            Use {'{{titulo}}'} para o nome da reunião e {'{{organizador}}'} para o e-mail do
            organizador. Data, horário, fuso, local, participantes, pauta e link da reunião são
            incluídos automaticamente abaixo do texto.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="invitation-signature">Assinatura dos convites</Label>
          <select
            id="invitation-signature"
            className={field}
            disabled={busy}
            value={signatureValue}
            onChange={(e) => {
              const value = e.target.value;
              setForm({
                ...form,
                signature_mode: value === 'default' || value === 'none' ? value : 'selected',
                signature_id: value === 'default' || value === 'none' ? null : value,
              });
            }}
          >
            <option value="default">Usar a assinatura padrão da conta</option>
            <option value="none">Sem assinatura</option>
            {form.signature_mode === 'selected' && !selected && (
              <option value={form.signature_id ?? ''} disabled>
                Assinatura indisponível — escolha outra
              </option>
            )}
            {signatures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.mailbox_id
                  ? ' · ' +
                    (mailboxes.find((b) => b.id === s.mailbox_id)?.name ?? 'Conta específica')
                  : ' · Todas as contas'}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Assinaturas de uma conta específica são usadas somente nos convites enviados por ela.{' '}
            <Link
              to="/settings/signatures"
              search={{ page: 1, pageSize: 10 }}
              className="text-primary underline underline-offset-2"
            >
              Gerenciar assinaturas
            </Link>
          </p>
          {selected && form.signature_mode === 'selected' && (
            <div className="overflow-x-auto rounded-md border p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Assinatura selecionada
              </p>
              <div
                className="text-sm"
                dangerouslySetInnerHTML={{ __html: signaturePreview(selected.body_html) }}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Este padrão vale para seus convites nesta organização.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar padrão de convites'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setForm({ ...form, message_template: DEFAULT_INVITATION_MESSAGE })}
          >
            <RotateCcw className="size-4" />
            Restaurar texto padrão
          </Button>
        </div>
      </form>
    </section>
  );
}
