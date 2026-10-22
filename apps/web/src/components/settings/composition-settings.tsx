import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react';
import { toast } from 'sonner';
import {
  COMPOSITION_FONTS,
  COMPOSITION_SIZES,
  DEFAULT_COMPOSITION_FORMAT,
  compositionFormatSchema,
  resolveCompositionFormat,
  type CompositionFormat,
  type CompositionPreferences,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, type Mailbox } from '@/lib/auth';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export function CompositionSettings() {
  const tenant = useTenantId();
  const preferences = useQuery({
    queryKey: ['composition-preferences', tenant],
    queryFn: () => api<CompositionPreferences>('/preferences/composition'),
  });
  const mailboxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  if (preferences.isPending || mailboxes.isPending) return <LoadingState />;
  if (preferences.isError || mailboxes.isError)
    return (
      <ErrorState
        onRetry={() => {
          void preferences.refetch();
          void mailboxes.refetch();
        }}
      />
    );
  return <CompositionForm preferences={preferences.data} mailboxes={mailboxes.data} />;
}
function CompositionForm({
  preferences,
  mailboxes,
}: {
  preferences: CompositionPreferences;
  mailboxes: Mailbox[];
}) {
  const [mailboxId, setMailboxId] = useState('all');
  const [error, setError] = useState('');
  const client = useQueryClient(),
    tenant = useTenantId();
  const form = useForm<CompositionFormat>({
    resolver: zodResolver(compositionFormatSchema),
    defaultValues: preferences.default_format,
  });
  const format = useWatch({ control: form.control });
  const overridden = preferences.overrides.some((override) => override.mailbox_id === mailboxId);
  const save = async (value: CompositionFormat | null) => {
    setError('');
    try {
      await api('/preferences/composition', {
        method: 'PUT',
        body: { mailbox_id: mailboxId === 'all' ? null : mailboxId, format: value },
      });
      const saved = await api<CompositionPreferences>('/preferences/composition');
      client.setQueryData(['composition-preferences', tenant], saved);
      form.reset(resolveCompositionFormat(saved, mailboxId));
      toast.success('Formatação padrão salva.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a formatação.');
    }
  };
  const field =
    'h-11 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';
  return (
    <section
      className="rounded-lg border bg-card p-4 sm:p-5"
      aria-labelledby="composition-settings-title"
    >
      <h2 id="composition-settings-title" className="text-base font-semibold">
        Fonte padrão de saída
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Personalize novos e-mails, respostas e encaminhamentos. A configuração é só sua; rascunhos e
        assinaturas mantêm a formatação existente.
      </p>
      <form className="mt-5 space-y-5" onSubmit={form.handleSubmit(save)}>
        <fieldset disabled={form.formState.isSubmitting} className="space-y-5 disabled:opacity-60">
          <div className="space-y-2">
            <Label htmlFor="composition-scope">Aplicar em</Label>
            <select
              id="composition-scope"
              className={field}
              value={mailboxId}
              onChange={(event) => {
                const id = event.target.value;
                setMailboxId(id);
                form.reset(resolveCompositionFormat(preferences, id));
                setError('');
              }}
            >
              <option value="all">Todas as minhas caixas — padrão pessoal</option>
              {mailboxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name} — {box.email_address}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {mailboxId === 'all'
                ? 'Caixas com uma personalização própria mantêm sua exceção.'
                : overridden
                  ? 'Esta caixa usa uma personalização própria.'
                  : 'Esta caixa está usando seu padrão pessoal. Salvar cria uma exceção para ela.'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="composition-font">Fonte</Label>
              <select id="composition-font" className={field} {...form.register('font_family')}>
                {COMPOSITION_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font.split(',')[0]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="composition-size">Tamanho (px)</Label>
              <select
                id="composition-size"
                className={field}
                {...form.register('font_size', { valueAsNumber: true })}
              >
                {COMPOSITION_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="composition-color">Cor do texto</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="composition-color"
                  type="color"
                  className="w-14 shrink-0 p-1"
                  {...form.register('color')}
                />
                <span className="text-xs font-mono">{format.color}</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Estilo</p>
            <div className="flex gap-2" role="group" aria-label="Estilo padrão">
              {(
                [
                  { key: 'bold', label: 'Negrito', Icon: Bold },
                  { key: 'italic', label: 'Itálico', Icon: Italic },
                  { key: 'underline', label: 'Sublinhado', Icon: Underline },
                  { key: 'strike', label: 'Tachado', Icon: Strikethrough },
                ] as const
              ).map(({ key, label, Icon }) => (
                <Button
                  key={key}
                  type="button"
                  variant={format[key] ? 'secondary' : 'outline'}
                  size="icon"
                  aria-label={label}
                  aria-pressed={!!format[key]}
                  onClick={() => form.setValue(key, !format[key], { shouldDirty: true })}
                >
                  <Icon />
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Prévia</p>
            <div className="overflow-hidden rounded-md border bg-white p-4">
              <p
                className="break-words"
                style={{
                  fontFamily: format.font_family,
                  fontSize: format.font_size,
                  lineHeight: 1.5,
                  color: format.color,
                  fontWeight: format.bold ? 700 : 400,
                  fontStyle: format.italic ? 'italic' : 'normal',
                  textDecoration: [
                    format.underline ? 'underline' : '',
                    format.strike ? 'line-through' : '',
                  ].join(' '),
                }}
              >
                Olá, tudo bem?
                <br />
                Esta é a aparência do texto dos seus próximos e-mails.
              </p>
            </div>
          </div>
          {Object.values(form.formState.errors).map((issue, index) => (
            <p key={index} role="alert" className="text-sm text-destructive">
              {issue.message}
            </p>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              {form.formState.isSubmitting ? 'Salvando…' : 'Salvar formatação'}
            </Button>
            {mailboxId !== 'all' && overridden ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void form.handleSubmit(() => save(null))()}
              >
                Usar padrão pessoal
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset(DEFAULT_COMPOSITION_FORMAT)}
              >
                Restaurar formatação inicial
              </Button>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}
