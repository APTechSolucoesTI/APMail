import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { chatNameSchema, type ChatConversation } from '@apmail/shared';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { UserAvatar } from '@/components/common/user-avatar';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PeoplePicker, useChatPeople, PeopleQueryState } from './people-picker';
export function GroupParticipants({ conversation }: { conversation: ChatConversation }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11">
          <Users className="size-4" aria-hidden />
          Participantes
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Participantes</SheetTitle>
          <SheetDescription>Gerencie as pessoas e o nome deste grupo.</SheetDescription>
        </SheetHeader>
        {open && <ParticipantsContent conversation={conversation} onClose={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}
function ParticipantsContent({
  conversation,
  onClose,
}: {
  conversation: ChatConversation;
  onClose: () => void;
}) {
  const me = useQuery(meQuery),
    people = useChatPeople(),
    client = useQueryClient(),
    navigate = useNavigate(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const form = useForm({
    resolver: zodResolver(chatNameSchema),
    defaultValues: { name: conversation.name ?? '' },
  });
  const change = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError('');
    try {
      await api('/chat/conversations/' + conversation.id + path, { method, body });
      await client.invalidateQueries({ queryKey: ['chat-conversations'] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6 p-4">
      <form
        className="space-y-2"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await change('', 'PATCH', values);
            toast.success('Nome atualizado.');
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        <Label htmlFor="chat-group-edit-name">Nome do grupo</Label>
        <Input
          id="chat-group-edit-name"
          maxLength={120}
          aria-invalid={!!form.formState.errors.name}
          {...form.register('name')}
        />
        {form.formState.errors.name && (
          <p role="alert" className="text-xs text-danger-fg">
            {form.formState.errors.name.message}
          </p>
        )}
        <Button variant="outline" disabled={busy}>
          Salvar nome
        </Button>
      </form>
      <section className="space-y-3">
        <h3 className="text-base font-semibold">No grupo ({conversation.participants.length})</h3>
        {conversation.participants.map((person) => (
          <p key={person.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden>
              <UserAvatar name={person.full_name} src={person.avatar_url} size={24} />
            </span>
            {person.full_name}
            {person.id === me.data?.user.id ? ' (você)' : ''}
          </p>
        ))}
      </section>
      <PeopleQueryState query={people} />
      <PeoplePicker
        label="Adicionar pessoas"
        people={(people.data ?? []).filter(
          (p) => !conversation.participants.some((member) => member.id === p.id),
        )}
        value={selected}
        onChange={setSelected}
        disabled={busy}
      />
      <Button
        disabled={busy || !selected.length}
        onClick={async () => {
          try {
            await change('/participants', 'POST', { user_ids: selected });
            setSelected([]);
            toast.success('Participantes adicionados.');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Adicionar ao grupo
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <div className="border-t pt-4">
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="text-danger-fg">
              Sair do grupo
            </Button>
          }
          title="Sair do grupo?"
          description="Você deixará de receber mensagens e de acessar esta conversa."
          pending={busy}
          onConfirm={async () => {
            await change('/participants/me', 'DELETE');
            onClose();
            await navigate({ to: '/chat' });
          }}
        />
      </div>
    </div>
  );
}
