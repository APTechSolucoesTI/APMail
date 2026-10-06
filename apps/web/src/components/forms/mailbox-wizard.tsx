import { useTenantId } from '@/lib/auth';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { mailboxSchema, PROVIDER_PRESETS, renderFromName, type MailboxRole } from '@apmail/shared';
import { SchemaForm, type FormField } from './schema-form';
import { api } from '@/lib/api';
import { meQuery, type Mailbox } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MailboxStatusBadge } from '@/components/common/status-badge';
export const connectionFields: FormField[] = [
  { name: 'username', label: 'Usuário' },
  {
    name: 'password',
    label: 'Senha de aplicativo',
    type: 'password',
    autoComplete: 'new-password',
  },
  { name: 'imap_host', label: 'Servidor IMAP' },
  { name: 'imap_port', label: 'Porta IMAP', type: 'number' },
  { name: 'imap_secure', label: 'TLS implícito no IMAP', type: 'checkbox' },
  { name: 'smtp_host', label: 'Servidor SMTP' },
  { name: 'smtp_port', label: 'Porta SMTP', type: 'number' },
  {
    name: 'smtp_secure',
    label: 'TLS implícito no SMTP',
    type: 'checkbox',
    help: 'Em porta 587, use STARTTLS: deixe esta opção desmarcada.',
  },
];
export function MailboxWizard({ onDone }: { onDone: () => void }) {
  const tenantId = useTenantId();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, unknown>>({
    imap_port: 993,
    imap_secure: true,
    smtp_port: 465,
    smtp_secure: true,
    sync_days: 90,
    history_classify_days: 0,
    append_sent_copy: true,
    from_name_template: '{mailbox_name}',
  });
  const [members, setMembers] = useState<{ user_id: string; role: MailboxRole }[]>([]);
  const [preset, setPreset] = useState('Outro');
  const [showPassword, setShowPassword] = useState(false);
  const [boxId, setBoxId] = useState<string | null>(null);
  const client = useQueryClient();
  const me = useQuery(meQuery);
  const directory = useQuery({
    queryKey: ['directory', tenantId],
    queryFn: () => api<{ id: string; full_name: string; email: string }[]>('/members/directory'),
  });
  const box = useQuery({
    queryKey: ['mailbox', tenantId, boxId],
    queryFn: () => api<Mailbox>('/mailboxes/' + boxId),
    enabled: !!boxId,
    refetchInterval: boxId ? 5000 : false,
  });
  if (boxId && step === 4)
    return (
      <div className="space-y-4">
        <MailboxStatusBadge status={box.data?.status ?? 'pending'} />
        <p role="status" className="text-sm">
          {box.data?.status === 'active'
            ? 'Caixa conectada! A importação dos e-mails começou.'
            : box.data?.status === 'error'
              ? (box.data.last_error ?? 'Não foi possível conectar. Confira os dados.')
              : 'Verificando conexão…'}
        </p>
        {box.data?.status === 'error' && (
          <Button variant="outline" onClick={() => setStep(1)}>
            Voltar e corrigir
          </Button>
        )}
        <Button onClick={onDone}>Concluir</Button>
      </div>
    );
  const next = (b: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, ...b }));
    setStep((s) => s + 1);
  };
  return (
    <div className="space-y-4">
      <ol aria-label="Etapas da conexão" className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {['Identificação', 'Servidor', 'Acesso', 'Sincronização e envio'].map((name, i) => (
          <li
            key={name}
            aria-current={i === step ? 'step' : undefined}
            className={
              i === step
                ? 'rounded-md bg-secondary p-2 font-semibold text-secondary-foreground'
                : 'rounded-md bg-muted p-2 text-muted-foreground'
            }
          >
            {i + 1}. {name}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <SchemaForm
          schema={mailboxSchema.pick({ name: true, email_address: true }).extend({
            aliases_input: z
              .string()
              .optional()
              .refine(
                (v) =>
                  !v ||
                  v
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .every((a) => mailboxSchema.shape.email_address.safeParse(a).success),
                'Confira os endereços dos aliases.',
              ),
          })}
          defaults={{
            ...draft,
            aliases_input: Array.isArray(draft.aliases) ? draft.aliases.join(', ') : '',
          }}
          fields={[
            { name: 'name', label: 'Nome da caixa' },
            { name: 'email_address', label: 'Endereço de e-mail', type: 'email' },
            {
              name: 'aliases_input',
              label: 'Aliases',
              type: 'emails',
              help: 'Separe endereços adicionais por vírgula.',
            },
          ]}
          submitLabel="Próximo"
          onSubmit={async (b) => {
            const aliases = String(b.aliases_input ?? '')
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);
            mailboxSchema.shape.aliases.parse(aliases);
            next({
              name: b.name,
              email_address: b.email_address,
              username: draft.username ?? b.email_address,
              aliases,
            });
          }}
        />
      )}
      {step === 1 && (
        <>
          <Label htmlFor="preset">Provedor</Label>
          <select
            id="preset"
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              const p = PROVIDER_PRESETS.find((p) => p.name === e.target.value)!;
              setDraft((prev) => ({
                ...prev,
                imap_host: p.imap_host,
                imap_port: 993,
                imap_secure: true,
                smtp_host: p.smtp_host,
                smtp_port: p.smtp_port,
                smtp_secure: p.smtp_port === 465,
              }));
            }}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {preset.includes('Microsoft') || preset.includes('Outlook')
              ? 'Muitas organizações desativaram IMAP/SMTP com senha. Se a conexão falhar, peça ao administrador para habilitar SMTP autenticado e IMAP para esta caixa.'
              : preset.includes('Gmail')
                ? 'Se a conta usa verificação em duas etapas, informe uma senha de aplicativo.'
                : 'Use os servidores indicados pelo seu provedor de e-mail.'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
          >
            {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          </Button>
          <SchemaForm
            key={preset}
            schema={mailboxSchema.pick({
              username: true,
              password: true,
              imap_host: true,
              imap_port: true,
              imap_secure: true,
              smtp_host: true,
              smtp_port: true,
              smtp_secure: true,
            })}
            defaults={draft}
            fields={connectionFields.map((f) =>
              f.name === 'password' ? { ...f, type: showPassword ? 'text' : 'password' } : f,
            )}
            submitLabel="Testar IMAP e SMTP e continuar"
            onSubmit={async (b) => {
              await api('/mailboxes/test-connection', { method: 'POST', body: b });
              next(b);
            }}
          />
        </>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Administradores da empresa acessam todas as caixas. Defina o acesso dos demais usuários.
          </p>
          {directory.data?.map((u) => (
            <fieldset key={u.id} className="rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold">{u.full_name}</legend>
              <RadioGroup
                value={members.find((m) => m.user_id === u.id)?.role ?? 'none'}
                onValueChange={(v) =>
                  setMembers((prev) => [
                    ...prev.filter((m) => m.user_id !== u.id),
                    ...(v === 'none' ? [] : [{ user_id: u.id, role: v as MailboxRole }]),
                  ])
                }
                className="grid grid-cols-2 gap-2"
              >
                {[
                  ['none', 'Sem acesso'],
                  ['viewer', 'Somente leitura'],
                  ['editor', 'Editor'],
                  ['mailbox_admin', 'Admin da caixa'],
                ].map(([role, label]) => (
                  <div key={role} className="flex min-h-11 items-center gap-2">
                    <RadioGroupItem value={role!} id={u.id + role} />
                    <Label htmlFor={u.id + role}>{label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          ))}
          <Button onClick={() => setStep(3)}>Próximo</Button>
        </div>
      )}
      {step === 3 && (
        <SchemaForm
          schema={mailboxSchema.pick({
            sync_days: true,
            history_classify_days: true,
            append_sent_copy: true,
            from_name_template: true,
          })}
          defaults={draft}
          fields={[
            {
              name: 'sync_days',
              label: 'Importar e-mails dos últimos (dias)',
              type: 'number',
              help: 'Opções: 30, 90, 180 ou 365.',
            },
            {
              name: 'history_classify_days',
              label: 'Classificar filas do histórico dos últimos (dias)',
              type: 'number',
              help: 'De 0 a 90. Com 0, todo o histórico fica sem fila. Esta escolha vale somente para a importação inicial; novos e-mails são classificados normalmente.',
            },
            {
              name: 'append_sent_copy',
              label: 'Salvar cópia na pasta Enviados',
              type: 'checkbox',
              help: 'Desative se o provedor já salva automaticamente e aparecerem duplicados.',
            },
            {
              name: 'from_name_template',
              label: 'Modelo do nome do remetente',
              type: 'select',
              options: [
                '{mailbox_name}',
                '{user_name} | {mailbox_name}',
                '{user_name} - {tenant_name}',
              ].map((value) => ({ value, label: value })),
            },
          ]}
          submitLabel="Testar e salvar caixa"
          renderPreview={(values) => (
            <p className="text-xs text-muted-foreground">
              Prévia do remetente:{' '}
              {renderFromName(String(values.from_name_template ?? draft.from_name_template), {
                user_name: me.data?.user.full_name ?? '',
                mailbox_name: String(draft.name ?? ''),
                tenant_name:
                  me.data?.tenants.find((t) => t.id === me.data?.current_tenant_id)?.name ?? '',
              })}
            </p>
          )}
          onSubmit={async (b) => {
            const body = mailboxSchema.parse({ ...draft, ...b, members });
            const result = await api<Mailbox>(boxId ? '/mailboxes/' + boxId : '/mailboxes', {
              method: boxId ? 'PATCH' : 'POST',
              body,
            });
            setBoxId(result.id);
            setDraft((prev) => ({ ...prev, password: undefined }));
            setStep(4);
            await client.invalidateQueries({ queryKey: ['mailboxes', tenantId] });
          }}
        />
      )}
      {step > 0 && (
        <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
          Voltar
        </Button>
      )}
    </div>
  );
}
