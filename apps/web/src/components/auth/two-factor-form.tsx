import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function TwoFactorForm({
  password = false,
  code = true,
  allowRecovery = true,
  submitLabel = 'Verificar',
  destructive = false,
  cancelLabel = 'Cancelar',
  cancelPending = false,
  onSubmit,
  onCancel,
}: {
  password?: boolean;
  code?: boolean;
  allowRecovery?: boolean;
  submitLabel?: string;
  destructive?: boolean;
  cancelLabel?: string;
  cancelPending?: boolean;
  onSubmit: (values: { password: string; code: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const schema = z.object({
    password: z
      .string()
      .max(256)
      .refine((v) => !password || !!v, 'Informe sua senha atual.'),
    code: z
      .string()
      .trim()
      .refine(
        (v) =>
          !code ||
          (recovery
            ? /^[A-F0-9]{20}$/.test(v.replace(/[\s-]/g, '').toUpperCase())
            : /^\d{6}$/.test(v)),
        recovery
          ? 'Informe um código de recuperação completo.'
          : 'Informe os 6 dígitos do aplicativo.',
      ),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', code: '' },
  });
  const busy = form.formState.isSubmitting || cancelPending;
  const submit = form.handleSubmit(async (values) => {
    setError('');
    try {
      await onSubmit(values);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível verificar. Tente novamente.');
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {password && (
        <div className="space-y-2">
          <Label htmlFor="two-factor-password">Senha atual</Label>
          <Input
            id="two-factor-password"
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
            disabled={busy}
            autoFocus
            aria-invalid={!!form.formState.errors.password}
            aria-describedby="two-factor-password-error"
          />
          {form.formState.errors.password && (
            <p id="two-factor-password-error" role="alert" className="text-sm text-destructive">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>
      )}
      {code && (
        <div className="space-y-2">
          <Label htmlFor="two-factor-code">
            {recovery ? 'Código de recuperação' : 'Código do aplicativo'}
          </Label>
          <Input
            id="two-factor-code"
            type="text"
            inputMode={recovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            maxLength={recovery ? 32 : 6}
            autoFocus={!password}
            {...form.register('code')}
            disabled={busy}
            className="font-mono tracking-wider"
            aria-invalid={!!form.formState.errors.code}
            aria-describedby="two-factor-code-help two-factor-code-error"
          />
          <p id="two-factor-code-help" className="text-xs text-muted-foreground">
            {recovery
              ? 'Cada código de recuperação funciona uma única vez.'
              : 'Digite os 6 dígitos exibidos no Google Authenticator ou em outro aplicativo compatível.'}
          </p>
          {form.formState.errors.code && (
            <p id="two-factor-code-error" role="alert" className="text-sm text-destructive">
              {form.formState.errors.code.message}
            </p>
          )}
          {allowRecovery && (
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              disabled={busy}
              onClick={() => {
                setRecovery(!recovery);
                form.setValue('code', '');
                form.clearErrors('code');
                setError('');
              }}
            >
              {recovery ? 'Usar código do aplicativo' : 'Usar código de recuperação'}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy}>
          {form.formState.isSubmitting ? 'Verificando…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {cancelPending ? 'Cancelando…' : cancelLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
