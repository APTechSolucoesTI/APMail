import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { chatEditSchema } from '@apmail/shared';
import { Ellipsis, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { upsertChatMessage, type ChatLocalMessage, type ChatPages } from '@/lib/chat';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { UserAvatar } from '@/components/common/user-avatar';
import { SharedEmailCard } from './shared-email-card';
export function MessageBubble({
  message,
  own,
  showSender,
  timezone,
  userId,
  now,
  onRetry,
}: {
  message: ChatLocalMessage;
  own: boolean;
  showSender: boolean;
  timezone: string;
  userId: string;
  now: number;
  onRetry: (message: ChatLocalMessage) => void;
}) {
  const [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false),
    [busy, setBusy] = useState(false),
    client = useQueryClient(),
    tenant = useTenantId();
  const editable =
    own &&
    !message.deleted_at &&
    !message.delivery &&
    now - new Date(message.created_at).getTime() <= 900000;
  const save = async (body: string | null) => {
    setBusy(true);
    try {
      const updated = await api<ChatLocalMessage>('/chat/messages/' + message.id, {
        method: body === null ? 'DELETE' : 'PATCH',
        ...(body === null ? {} : { body: { body } }),
      });
      client.setQueryData<ChatPages>(
        ['chat-messages', tenant, message.conversation_id, userId],
        (data) => upsertChatMessage(data, updated),
      );
      await client.invalidateQueries({ queryKey: ['chat-conversations', tenant] });
      setEdit(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', own ? 'items-end' : 'items-start')}>
      {showSender && !own && (
        <p className="flex items-center gap-2 text-xs font-semibold">
          <span aria-hidden>
            <UserAvatar name={message.sender.full_name} src={message.sender.avatar_url} size={24} />
          </span>
          {message.sender.full_name}
        </p>
      )}
      <div
        className={cn(
          'max-w-full rounded-lg p-3 sm:max-w-[85%]',
          own ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
        data-message-id={message.id}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {message.deleted_at ? (
              <p className="text-sm italic">Mensagem apagada</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                {message.shared_thread_id && message.shared_snapshot && (
                  <SharedEmailCard
                    threadId={message.shared_thread_id}
                    snapshot={message.shared_snapshot}
                  />
                )}
              </>
            )}
          </div>
          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 text-inherit hover:bg-background/10 hover:text-inherit sm:h-8 sm:w-8"
                  aria-label="Ações da mensagem"
                >
                  <Ellipsis className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEdit(true)}>
                  <Pencil className="size-4" aria-hidden />
                  Editar mensagem
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-danger-fg" onSelect={() => setRemove(true)}>
                  <Trash2 className="size-4" aria-hidden />
                  Apagar mensagem
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[11px]">
          <time
            dateTime={message.created_at}
            title={new Date(message.created_at).toLocaleString('pt-BR', { timeZone: timezone })}
          >
            {new Date(message.created_at).toLocaleTimeString('pt-BR', {
              timeZone: timezone,
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          {message.edited_at && <span>(editada)</span>}
          {message.delivery === 'sending' && <span role="status">Enviando…</span>}
        </p>
      </div>
      {message.delivery === 'failed' && (
        <div role="alert" className="flex items-center gap-2 text-xs text-danger-fg">
          <span>Não foi possível enviar.</span>
          <Button variant="outline" size="sm" onClick={() => onRetry(message)}>
            <RotateCcw className="size-4" aria-hidden />
            Tentar novamente
          </Button>
        </div>
      )}
      <Dialog
        open={edit}
        onOpenChange={(open) => {
          if (!busy) setEdit(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar mensagem</DialogTitle>
            <DialogDescription>Altere sua mensagem nos primeiros 15 minutos.</DialogDescription>
          </DialogHeader>
          {edit && (
            <EditMessage
              key={message.id + (message.edited_at ?? '')}
              body={message.body}
              onSave={save}
              onCancel={() => setEdit(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        title="Apagar mensagem?"
        description="A mensagem será substituída por ‘Mensagem apagada’ para os participantes."
        destructive
        pending={busy}
        onConfirm={() => save(null)}
      />
    </div>
  );
}
function EditMessage({
  body,
  onSave,
  onCancel,
}: {
  body: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState(''),
    form = useForm({ resolver: zodResolver(chatEditSchema), defaultValues: { body } });
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit(async (values) => {
        setError('');
        try {
          await onSave(values.body);
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <Label htmlFor="chat-edit-message">Mensagem</Label>
      <Textarea
        id="chat-edit-message"
        rows={4}
        maxLength={4000}
        aria-invalid={!!form.formState.errors.body}
        {...form.register('body')}
      />
      {form.formState.errors.body && (
        <p role="alert" className="text-xs text-danger-fg">
          {form.formState.errors.body.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          type="button"
          onClick={onCancel}
          disabled={form.formState.isSubmitting}
        >
          Cancelar
        </Button>
        <Button disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando…' : 'Salvar mensagem'}
        </Button>
      </div>
    </form>
  );
}
