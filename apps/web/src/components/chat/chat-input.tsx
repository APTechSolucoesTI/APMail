import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { chatEditSchema } from '@apmail/shared';
import { SendHorizontal } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
export function ChatInput({
  disabled,
  onSend,
  onTyping,
}: {
  disabled: boolean;
  onSend: (body: string) => Promise<void>;
  onTyping: () => void;
}) {
  const form = useForm({ resolver: zodResolver(chatEditSchema), defaultValues: { body: '' } }),
    body = useWatch({ control: form.control, name: 'body' });
  const submit = form.handleSubmit(async (values) => {
    form.reset({ body: '' });
    await onSend(values.body);
  });
  return (
    <form className="space-y-2 border-t bg-card p-4" onSubmit={submit}>
      <Label htmlFor="chat-message">Mensagem</Label>
      <div className="flex items-end gap-2">
        <Textarea
          id="chat-message"
          rows={1}
          maxLength={4000}
          className="max-h-36 min-h-11 resize-none [field-sizing:content]"
          placeholder="Escreva uma mensagem…"
          disabled={disabled || form.formState.isSubmitting}
          aria-invalid={!!form.formState.errors.body}
          aria-describedby="chat-input-help"
          {...form.register('body', { onChange: onTyping })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled && !form.formState.isSubmitting) void submit();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={disabled || form.formState.isSubmitting || !body.trim()}
          aria-label="Enviar mensagem"
        >
          <SendHorizontal className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <p id="chat-input-help">Enter envia · Shift+Enter quebra linha</p>
        {body.length > 3800 && <span aria-live="polite">{body.length}/4000</span>}
      </div>
      {form.formState.errors.body && (
        <p role="alert" className="text-xs text-danger-fg">
          {form.formState.errors.body.message}
        </p>
      )}
    </form>
  );
}
