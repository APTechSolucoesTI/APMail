import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ApiError } from '@/lib/api';
import { X } from 'lucide-react';
export type FormField = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'checkbox' | 'select' | 'emails';
  autoComplete?: string;
  help?: string;
  options?: { value: string; label: string }[];
};
export function SchemaForm({
  schema,
  fields,
  defaults = {},
  submitLabel = 'Salvar',
  onSubmit,
  children,
  cancelLabel,
  renderPreview,
}: {
  schema: z.ZodObject;
  fields: FormField[];
  defaults?: Record<string, unknown>;
  submitLabel?: string;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
  children?: React.ReactNode;
  cancelLabel?: string;
  renderPreview?: (values: Record<string, unknown>) => React.ReactNode;
}) {
  const [error, setError] = useState('');
  const form = useForm({ resolver: zodResolver(schema), defaultValues: defaults });
  const values = useWatch({ control: form.control });
  const submit = form.handleSubmit(async (values) => {
    setError('');
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
      if (e instanceof ApiError && e.details)
        for (const [name, messages] of Object.entries(e.details))
          form.setError(name, { message: messages[0] });
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {fields.map((field) => {
        const message = form.getFieldState(field.name, form.formState).error?.message;
        const id = 'field-' + field.name;
        return (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={id}>{field.label}</Label>
            {field.type === 'checkbox' ? (
              <div className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={id}
                  checked={
                    !!field.name
                      .split('.')
                      .reduce<unknown>(
                        (obj, key) =>
                          obj && typeof obj === 'object'
                            ? (obj as Record<string, unknown>)[key]
                            : undefined,
                        values,
                      )
                  }
                  onCheckedChange={(v) =>
                    form.setValue(field.name, v === true, { shouldValidate: true })
                  }
                  aria-invalid={!!message}
                />
                <span className="text-sm">{field.help ?? 'Habilitado'}</span>
              </div>
            ) : field.type === 'select' ? (
              <select
                id={id}
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm sm:h-9"
                {...form.register(field.name)}
                aria-invalid={!!message}
                aria-describedby={message ? id + '-error' : undefined}
              >
                {field.options?.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                type={field.type === 'emails' ? 'text' : (field.type ?? 'text')}
                autoComplete={field.autoComplete}
                {...form.register(field.name, { valueAsNumber: field.type === 'number' })}
                aria-invalid={!!message}
                aria-describedby={message ? id + '-error' : field.help ? id + '-help' : undefined}
              />
            )}
            {field.type === 'emails' && typeof values[field.name] === 'string' && (
              <div className="flex flex-wrap gap-2">
                {(values[field.name] as string)
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .map((address, index) => (
                    <span
                      key={index}
                      className="inline-flex max-w-full items-center gap-2 rounded-md border bg-muted pl-2 text-xs"
                    >
                      <span className="break-all">{address}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={'Remover alias ' + address}
                        onClick={() =>
                          form.setValue(
                            field.name,
                            (values[field.name] as string)
                              .split(',')
                              .map((v) => v.trim())
                              .filter(Boolean)
                              .filter((_v, i) => i !== index)
                              .join(', '),
                          )
                        }
                      >
                        <X aria-hidden />
                      </Button>
                    </span>
                  ))}
              </div>
            )}
            {field.help && field.type !== 'checkbox' && (
              <p id={id + '-help'} className="text-xs text-muted-foreground">
                {field.help}
              </p>
            )}
            {typeof message === 'string' && (
              <p id={id + '-error'} role="alert" className="text-xs text-destructive">
                {message}
              </p>
            )}
          </div>
        );
      })}
      {children}
      {renderPreview?.(values)}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Aguarde…' : submitLabel}
        </Button>
        {cancelLabel && (
          <Button
            variant="outline"
            type="button"
            disabled={form.formState.isSubmitting}
            onClick={() => {
              form.reset(defaults);
              setError('');
            }}
          >
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
