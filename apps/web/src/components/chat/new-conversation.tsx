import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { directConversationSchema, groupConversationSchema } from '@apmail/shared';
import { Plus, Users, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { PersonCombobox, PeoplePicker, useChatPeople, PeopleQueryState } from './people-picker';
export function NewConversation() {
  const [mode, setMode] = useState<'direct' | 'group'>();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="min-h-11">
            <Plus className="size-4" aria-hidden />
            Nova conversa
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode('direct')}>
            <MessageSquare className="size-4" aria-hidden />
            Mensagem direta
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode('group')}>
            <Users className="size-4" aria-hidden />
            Novo grupo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={!!mode}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(undefined);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{mode === 'group' ? 'Novo grupo' : 'Mensagem direta'}</DialogTitle>
            <DialogDescription>
              {mode === 'group'
                ? 'Escolha pelo menos duas pessoas para conversar com você.'
                : 'Inicie uma conversa com alguém da empresa.'}
            </DialogDescription>
          </DialogHeader>
          {mode && (
            <ConversationForm
              key={mode}
              mode={mode}
              onClose={() => setMode(undefined)}
              onBusy={setBusy}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ConversationForm({
  mode,
  onClose,
  onBusy,
}: {
  mode: 'direct' | 'group';
  onClose: () => void;
  onBusy: (value: boolean) => void;
}) {
  const people = useChatPeople(),
    me = useQuery(meQuery),
    client = useQueryClient(),
    navigate = useNavigate(),
    [error, setError] = useState('');
  const schema = z
    .object({ name: z.string().trim().max(120), user_id: z.string(), user_ids: z.array(z.uuid()) })
    .superRefine((data, ctx) => {
      if (mode === 'direct' && !z.uuid().safeParse(data.user_id).success)
        ctx.addIssue({ code: 'custom', path: ['user_id'], message: 'Escolha uma pessoa.' });
      if (mode === 'group') {
        if (!data.name)
          ctx.addIssue({ code: 'custom', path: ['name'], message: 'Informe o nome.' });
        if (data.user_ids.length < 2)
          ctx.addIssue({
            code: 'custom',
            path: ['user_ids'],
            message: 'Escolha pelo menos duas pessoas.',
          });
      }
    });
  const form = useForm({
      resolver: zodResolver(schema),
      defaultValues: { name: '', user_id: '', user_ids: [] as string[] },
    }),
    value = useWatch({ control: form.control });
  const submit = form.handleSubmit(async (values) => {
    setError('');
    onBusy(true);
    try {
      const body =
        mode === 'direct'
          ? directConversationSchema.parse({ user_id: values.user_id })
          : groupConversationSchema.parse({ name: values.name, user_ids: values.user_ids });
      const result = await api<{ id: string }>('/chat/conversations/' + mode, {
        method: 'POST',
        body,
      });
      await client.invalidateQueries({ queryKey: ['chat-conversations'] });
      onClose();
      await navigate({ to: '/chat/$conversationId', params: { conversationId: result.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      onBusy(false);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4">
      <PeopleQueryState query={people} />
      {mode === 'group' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="chat-group-name">Nome do grupo</Label>
            <Input
              id="chat-group-name"
              maxLength={120}
              aria-invalid={!!form.formState.errors.name}
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p role="alert" className="text-xs text-danger-fg">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <PeoplePicker
            people={(people.data ?? []).filter((p) => p.id !== me.data?.user.id)}
            value={value.user_ids ?? []}
            onChange={(ids) => form.setValue('user_ids', ids, { shouldValidate: true })}
            disabled={form.formState.isSubmitting}
          />
          {form.formState.errors.user_ids && (
            <p role="alert" className="text-xs text-danger-fg">
              {form.formState.errors.user_ids.message}
            </p>
          )}
        </>
      ) : (
        <>
          <PersonCombobox
            people={(people.data ?? []).filter((p) => p.id !== me.data?.user.id)}
            value={value.user_id ?? ''}
            onChange={(id) => form.setValue('user_id', id, { shouldValidate: true })}
            invalid={!!form.formState.errors.user_id}
          />
          {form.formState.errors.user_id && (
            <p role="alert" className="text-xs text-danger-fg">
              {form.formState.errors.user_id.message}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={form.formState.isSubmitting}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting || !people.data}>
          {form.formState.isSubmitting ? 'Criando…' : 'Iniciar conversa'}
        </Button>
      </div>
    </form>
  );
}
