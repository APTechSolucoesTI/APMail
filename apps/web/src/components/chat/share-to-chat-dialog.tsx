import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { shareThreadSchema } from '@apmail/shared';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { chatName } from '@/lib/chat';
import { useChatConversations } from '@/hooks/use-chat';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SearchInput } from '@/components/data/search-input';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { PeoplePicker, useChatPeople, PeopleQueryState } from './people-picker';
export function ShareToChatDialog({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11">
          <MessageSquare className="size-4" aria-hidden />
          Compartilhar no chat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Compartilhar no chat</DialogTitle>
          <DialogDescription>
            Envie o resumo deste e-mail para conversas ou pessoas da empresa.
          </DialogDescription>
        </DialogHeader>
        {open && <ShareForm threadId={threadId} onClose={() => setOpen(false)} onBusy={setBusy} />}
      </DialogContent>
    </Dialog>
  );
}
function ShareForm({
  threadId,
  onClose,
  onBusy,
}: {
  threadId: string;
  onClose: () => void;
  onBusy: (value: boolean) => void;
}) {
  const conversations = useChatConversations(),
    people = useChatPeople(),
    me = useQuery(meQuery),
    client = useQueryClient(),
    [search, setSearch] = useState(''),
    [error, setError] = useState('');
  const [clientId] = useState(() => crypto.randomUUID());
  const form = useForm<
      z.input<typeof shareThreadSchema>,
      unknown,
      z.output<typeof shareThreadSchema>
    >({
      resolver: zodResolver(shareThreadSchema),
      defaultValues: {
        thread_id: threadId,
        conversation_ids: [],
        user_ids: [],
        comment: '',
        client_id: clientId,
      },
    }),
    values = useWatch({ control: form.control });
  const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('pt-BR'),
    rows = (conversations.data ?? []).filter((c) =>
      normalize(chatName(c, me.data?.user.id ?? '')).includes(normalize(search)),
    );
  const directUsers = new Set(
    (conversations.data ?? [])
      .filter((c) => c.type === 'direct')
      .flatMap((c) => c.participants.filter((p) => p.id !== me.data?.user.id).map((p) => p.id)),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (body) => {
        setError('');
        onBusy(true);
        try {
          await api('/chat/share-thread', { method: 'POST', body });
          await client.invalidateQueries({ queryKey: ['chat-conversations'] });
          toast.success('E-mail compartilhado');
          onClose();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          onBusy(false);
        }
      })}
    >
      <fieldset disabled={form.formState.isSubmitting} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          Conversas existentes ({values.conversation_ids?.length ?? 0})
        </legend>
        <SearchInput
          value={search}
          onChange={setSearch}
          debounce={0}
          placeholder="Buscar conversas…"
        />
        {conversations.isLoading ? (
          <LoadingState />
        ) : conversations.error ? (
          <ErrorState onRetry={() => void conversations.refetch()} />
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-md border">
            {rows.map((c) => (
              <Label
                key={c.id}
                htmlFor={'share-chat-' + c.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted"
              >
                <Checkbox
                  id={'share-chat-' + c.id}
                  checked={values.conversation_ids?.includes(c.id) ?? false}
                  onCheckedChange={(checked) =>
                    form.setValue(
                      'conversation_ids',
                      checked
                        ? [...(values.conversation_ids ?? []), c.id]
                        : values.conversation_ids?.filter((id) => id !== c.id),
                      { shouldValidate: true },
                    )
                  }
                />
                <span className="min-w-0 break-words">{chatName(c, me.data?.user.id ?? '')}</span>
              </Label>
            ))}
            {!rows.length && (
              <p className="p-3 text-xs text-muted-foreground">
                Nenhuma conversa encontrada. Escolha uma pessoa abaixo.
              </p>
            )}
          </div>
        )}
      </fieldset>
      <PeopleQueryState query={people} />
      <PeoplePicker
        label="Pessoas sem conversa direta"
        people={(people.data ?? []).filter(
          (p) => p.id !== me.data?.user.id && !directUsers.has(p.id),
        )}
        value={values.user_ids ?? []}
        onChange={(ids) => form.setValue('user_ids', ids, { shouldValidate: true })}
        disabled={form.formState.isSubmitting}
      />
      <div className="space-y-2">
        <Label htmlFor="share-chat-comment">Comentário (opcional)</Label>
        <Textarea
          id="share-chat-comment"
          rows={3}
          maxLength={4000}
          aria-invalid={!!form.formState.errors.comment}
          {...form.register('comment')}
        />
      </div>
      {(form.formState.errors.user_ids || form.formState.errors.comment) && (
        <p role="alert" className="text-xs text-danger-fg">
          {form.formState.errors.user_ids?.message ?? form.formState.errors.comment?.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          type="button"
          disabled={form.formState.isSubmitting}
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button disabled={form.formState.isSubmitting || !conversations.data || !people.data}>
          {form.formState.isSubmitting ? 'Compartilhando…' : 'Compartilhar e-mail'}
        </Button>
      </div>
    </form>
  );
}
