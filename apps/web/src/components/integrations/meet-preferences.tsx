import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { meetPreferencesSchema, meetPlanLabels, type MeetPreferences } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, canMailbox, type Mailbox } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
export const compactSelect =
  'h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm sm:h-8';
export function MeetPreferencesForm({ initial }: { initial: MeetPreferences }) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const tenant = useTenantId(),
    client = useQueryClient(),
    boxes = useQuery({
      queryKey: ['mailboxes', tenant],
      queryFn: () => api<Mailbox[]>('/mailboxes'),
    });
  const persist = async () => {
    const parsed = meetPreferencesSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/integrations/google/meet/preferences', { method: 'PUT', body: parsed.data });
      await client.invalidateQueries({ queryKey: ['google-integration', tenant] });
      await client.invalidateQueries({ queryKey: ['meet-reports', tenant] });
      toast.success('Preferências do Google Meet salvas.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const check = (
    key:
      'auto_recording' | 'auto_transcription' | 'auto_notes' | 'sync_enabled' | 'artifacts_consent',
    label: string,
    help?: string,
  ) => (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        checked={form[key]}
        disabled={busy}
        onCheckedChange={(value) =>
          setForm({
            ...form,
            [key]: value === true,
            ...(key === 'artifacts_consent' && value !== true ? { sync_enabled: false } : {}),
          })
        }
      />
      <span>
        {label}
        {help && <span className="mt-1 block text-xs text-muted-foreground">{help}</span>}
      </span>
    </label>
  );
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Preferências de novas reuniões</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        Valem para sua conta nesta organização. O Google pode restringir os recursos solicitados.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (initial.artifacts_consent && !form.artifacts_consent) setConfirm(true);
          else void persist().catch(() => undefined);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            Meu plano Google (informado por você)
            <select
              aria-label="Meu plano Google"
              className={compactSelect + ' w-full'}
              value={form.declared_plan}
              disabled={busy}
              onChange={(e) =>
                setForm({
                  ...form,
                  declared_plan: e.target.value as MeetPreferences['declared_plan'],
                })
              }
            >
              {Object.entries(meetPlanLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Caixa de e-mail associada
            <select
              aria-label="Caixa de e-mail associada"
              className={compactSelect + ' w-full'}
              value={form.mailbox_id ?? ''}
              disabled={busy || boxes.isPending}
              onChange={(e) => setForm({ ...form, mailbox_id: e.target.value || null })}
            >
              <option value="">Definir no convite</option>
              {boxes.data
                ?.filter((box) => canMailbox(box, 'send'))
                .map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.name} · {box.email_address}
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Acesso padrão à sala
            <select
              aria-label="Acesso padrão à sala"
              className={compactSelect + ' w-full'}
              disabled={busy}
              value={form.default_access}
              onChange={(e) =>
                setForm({
                  ...form,
                  default_access: e.target.value as MeetPreferences['default_access'],
                })
              }
            >
              <option value="TRUSTED">Confiável · convidados entram diretamente</option>
              <option value="RESTRICTED">Restrito · somente convidados</option>
              <option value="OPEN">Aberto · qualquer pessoa com o link</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Retenção dos relatórios no APMail (dias)
            <Input
              aria-label="Retenção dos relatórios no APMail"
              type="number"
              min={30}
              max={3650}
              value={form.retention_days}
              disabled={busy}
              onChange={(e) => setForm({ ...form, retention_days: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs font-semibold">Geração de arquivos pelo Google</p>
          {check('auto_recording', 'Solicitar gravação automática')}
          {check('auto_transcription', 'Solicitar transcrição automática')}
          {check('auto_notes', 'Solicitar notas inteligentes automáticas')}
          <p className="text-xs text-muted-foreground">
            Ativadas quando um participante com o privilégio necessário entrar. A autorização e a
            assinatura elegível são verificadas pelo Google ao criar ou alterar a sala.
          </p>
        </div>
        <div className="space-y-3 rounded-md border p-3">
          {check(
            'artifacts_consent',
            'Autorizar a importação de dados de reuniões',
            'Permite importar participantes, sessões, metadados de arquivos e transcrições das reuniões associadas. Você é responsável por informar os participantes conforme as regras aplicáveis.',
          )}
          {check(
            'sync_enabled',
            'Sincronizar automaticamente em segundo plano',
            'Após as reuniões, buscar os dados disponíveis sem precisar manter o navegador aberto.',
          )}
          <p className="text-xs text-muted-foreground">
            O Google mantém os registros e trechos estruturados por cerca de 30 dias. A retenção
            acima vale para dados já importados. Não são criadas avaliações de produtividade
            individual.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || boxes.isError}>
          {busy ? 'Salvando…' : 'Salvar preferências do Meet'}
        </Button>
        {boxes.isError && (
          <p role="alert" className="text-xs text-destructive">
            Não foi possível carregar suas caixas.{' '}
            <button type="button" className="underline" onClick={() => void boxes.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
      </form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remover dados importados?"
        description="Ao retirar a autorização, os relatórios, sessões, transcrições e notas já importados desta conexão serão removidos do APMail. Eventos, contatos e arquivos originais do Google permanecem. Registros expirados no Google podem não ser recuperados."
        destructive
        onConfirm={async () => {
          await persist();
          setConfirm(false);
        }}
      />
    </section>
  );
}
