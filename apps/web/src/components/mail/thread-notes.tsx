import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  noteMentions,
  threadNoteSchema,
  QUEUE_LABELS,
  type MailboxRole,
} from '@apmail/shared';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Pencil, Trash2, MessageSquare, History } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UserAvatar } from '@/components/common/user-avatar';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/data/data-state';
type Note = {
  id: string;
  author_id: string;
  author_name: string;
  avatar_url: string | null;
  body: string;
  mentioned_user_ids: string[];
  created_at: string;
  updated_at: string;
};
type User = { id: string; full_name: string; avatar_url: string | null };
type Timeline = {
  id: string;
  type: 'status' | 'assignment';
  from_status?: keyof typeof QUEUE_LABELS;
  to_status?: keyof typeof QUEUE_LABELS;
  reason?: string;
  changed_by_name: string | null;
  assigned_to_name?: string | null;
  created_at: string;
};
const reasons: Record<string, string> = {
  inbound: 'E-mail recebido',
  outbound: 'Resposta enviada',
  manual: 'Alteração manual',
  assignment: 'Atribuição',
  schedule: 'Agendamento',
  rule: 'Regra de e-mail',
  sync: 'Sincronização',
};
function NoteBody({ note }: { note: Note }) {
  const parts: React.ReactNode[] = [];
  let start = 0;
  for (const m of noteMentions(note.body)) {
    parts.push(note.body.slice(start, m.index));
    parts.push(
      note.mentioned_user_ids.includes(m.user_id) ? (
        <span
          key={m.index}
          className="rounded-sm bg-secondary px-1 font-medium text-secondary-foreground"
        >
          @{m.full_name}
        </span>
      ) : (
        m.text
      ),
    );
    start = m.index + m.text.length;
  }
  parts.push(note.body.slice(start));
  return <p className="whitespace-pre-wrap break-words text-sm">{parts}</p>;
}
export function ThreadNotes({
  threadId,
  mailboxId,
  role,
}: {
  threadId: string;
  mailboxId: string;
  role: MailboxRole;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery),
    [tab, setTab] = useState('notes'),
    [editing, setEditing] = useState<Note | null>(null),
    [now, setNow] = useState(Date.now),
    [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null),
    [option, setOption] = useState(0),
    input = useRef<HTMLTextAreaElement | null>(null);
  const form = useForm<{ body: string; mentioned_user_ids?: string[] }>({
    resolver: zodResolver(threadNoteSchema),
    defaultValues: { body: '', mentioned_user_ids: [] },
  });
  const notes = useQuery({
      queryKey: ['thread-notes', tenant, threadId],
      queryFn: () => api<Note[]>('/threads/' + threadId + '/notes'),
    }),
    history = useQuery({
      queryKey: ['thread-history', tenant, threadId],
      queryFn: () => api<Timeline[]>('/threads/' + threadId + '/history'),
      enabled: tab === 'history',
    }),
    users = useQuery({
      queryKey: ['mentionable', tenant, mailboxId],
      queryFn: () => api<User[]>('/mailboxes/' + mailboxId + '/mentionable'),
      enabled: can(role, 'note'),
    });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR');
  const options = mention
    ? (users.data ?? [])
        .filter((u) => normalize(u.full_name).includes(normalize(mention.query)))
        .slice(0, 8)
    : [];
  const choose = (u: User) => {
    if (!mention) return;
    const body = form.getValues('body'),
      text = `@[${u.full_name.replace(/[\]\r\n]/g, '')}](${u.id}) `;
    form.setValue('body', body.slice(0, mention.start) + text + body.slice(mention.end), {
      shouldDirty: true,
      shouldValidate: true,
    });
    const cursor = mention.start + text.length;
    setMention(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(cursor, cursor);
    });
  };
  const submit = form.handleSubmit(async (b) => {
    try {
      await api(editing ? '/notes/' + editing.id : '/threads/' + threadId + '/notes', {
        method: editing ? 'PATCH' : 'POST',
        body: { body: b.body, mentioned_user_ids: noteMentions(b.body).map((m) => m.user_id) },
      });
      form.reset({ body: '', mentioned_user_ids: [] });
      setEditing(null);
      setMention(null);
      void client.invalidateQueries({ queryKey: ['thread-notes', tenant, threadId] });
      toast.success(editing ? 'Nota atualizada.' : 'Nota adicionada.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  });
  const field = form.register('body');
  return (
    <section className="rounded-lg border bg-card" aria-label="Notas e histórico">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="m-3">
          <TabsTrigger value="notes">
            <MessageSquare className="size-4" />
            Notas internas ({notes.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" />
            Histórico
          </TabsTrigger>
        </TabsList>
        <TabsContent value="notes" className="space-y-4 p-4 pt-0">
          <p className="text-xs text-muted-foreground">
            Visível apenas para a equipe. Estas notas não são enviadas por e-mail.
          </p>
          {notes.isLoading ? (
            <LoadingState />
          ) : notes.isError ? (
            <ErrorState onRetry={() => void notes.refetch()} />
          ) : !notes.data?.length ? (
            <EmptyState
              title="Nenhuma nota interna"
              description="As observações da equipe aparecem aqui."
            />
          ) : (
            <ol className="space-y-4">
              {notes.data.map((note) => (
                <li key={note.id} className="space-y-2 border-b pb-4 last:border-0">
                  <div className="flex items-start gap-2">
                    <UserAvatar name={note.author_name} src={note.avatar_url} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{note.author_name}</p>
                      <time
                        dateTime={note.created_at}
                        title={new Date(note.created_at).toLocaleString('pt-BR', {
                          timeZone: me.data?.preferences.timezone,
                        })}
                        className="text-xs text-muted-foreground"
                      >
                        {formatDistanceToNow(new Date(note.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                        {note.updated_at !== note.created_at ? ' · editada' : ''}
                      </time>
                    </div>
                    {can(role, 'note') &&
                      note.author_id === me.data?.user.id &&
                      now - new Date(note.created_at).getTime() <= 900000 && (
                        <div className="flex">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-11 sm:size-8"
                            aria-label="Editar nota"
                            disabled={form.formState.isSubmitting}
                            onClick={() => {
                              setEditing(note);
                              form.reset({
                                body: note.body,
                                mentioned_user_ids: note.mentioned_user_ids,
                              });
                              input.current?.focus();
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <ConfirmDialog
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-11 text-destructive sm:size-8"
                                aria-label="Excluir nota"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            }
                            title="Excluir nota?"
                            description="A nota será removida da conversa."
                            onConfirm={async () => {
                              await api('/notes/' + note.id, { method: 'DELETE' });
                              void client.invalidateQueries({
                                queryKey: ['thread-notes', tenant, threadId],
                              });
                            }}
                          />
                        </div>
                      )}
                  </div>
                  <NoteBody note={note} />
                </li>
              ))}
            </ol>
          )}
          {can(role, 'note') && (
            <form onSubmit={submit} className="space-y-2">
              <Label htmlFor={'note-' + threadId}>
                {editing ? 'Editar nota interna' : 'Nova nota interna'}
              </Label>
              <div className="relative">
                <Textarea
                  id={'note-' + threadId}
                  {...field}
                  ref={(el) => {
                    field.ref(el);
                    input.current = el;
                  }}
                  maxLength={5000}
                  rows={3}
                  disabled={form.formState.isSubmitting}
                  aria-invalid={!!form.formState.errors.body}
                  aria-describedby={'note-help-' + threadId}
                  aria-controls={mention ? 'note-mentions' : undefined}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  aria-activedescendant={
                    mention && options[option]
                      ? 'mention-' + threadId + '-' + options[option]!.id
                      : undefined
                  }
                  aria-expanded={!!mention}
                  onChange={(e) => {
                    void field.onChange(e);
                    const end = e.target.selectionStart,
                      prefix = e.target.value.slice(0, end),
                      m = /(?:^|\s)@([^\s@[\]]{0,40})$/.exec(prefix);
                    setMention(m ? { start: end - m[1]!.length - 1, end, query: m[1]! } : null);
                    setOption(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void submit();
                      return;
                    }
                    if (mention) {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setMention(null);
                      } else if (['ArrowDown', 'ArrowUp'].includes(e.key) && options.length) {
                        e.preventDefault();
                        setOption(
                          (i) =>
                            (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) %
                            options.length,
                        );
                      } else if (e.key === 'Enter' && options[option]) {
                        e.preventDefault();
                        choose(options[option]!);
                      }
                    }
                  }}
                />
                {mention && (
                  <div
                    id="note-mentions"
                    role="listbox"
                    aria-label="Pessoas para mencionar"
                    className="absolute bottom-full z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-card"
                  >
                    {options.length ? (
                      options.map((u, i) => (
                        <button
                          type="button"
                          key={u.id}
                          id={'mention-' + threadId + '-' + u.id}
                          role="option"
                          aria-selected={i === option}
                          className={
                            'flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted ' +
                            (i === option ? 'bg-secondary' : '')
                          }
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choose(u)}
                        >
                          <span aria-hidden>
                            <UserAvatar name={u.full_name} src={u.avatar_url} size={24} />
                          </span>
                          {u.full_name}
                        </button>
                      ))
                    ) : (
                      <p className="p-3 text-sm text-muted-foreground">
                        {users.isLoading ? 'Carregando pessoas…' : 'Nenhuma pessoa encontrada.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {form.formState.errors.body && (
                <p role="alert" className="text-sm text-danger-fg">
                  {form.formState.errors.body.message}
                </p>
              )}
              <p id={'note-help-' + threadId} className="text-xs text-muted-foreground">
                Use @ para mencionar uma pessoa. Ctrl+Enter adiciona a nota.
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting
                    ? 'Salvando…'
                    : editing
                      ? 'Salvar nota'
                      : 'Adicionar nota'}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={form.formState.isSubmitting}
                    onClick={() => {
                      setEditing(null);
                      form.reset({ body: '', mentioned_user_ids: [] });
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </form>
          )}
        </TabsContent>
        <TabsContent value="history" className="p-4 pt-0">
          {history.isLoading ? (
            <LoadingState />
          ) : history.isError ? (
            <ErrorState onRetry={() => void history.refetch()} />
          ) : !history.data?.length ? (
            <EmptyState
              title="Nenhuma transição"
              description="Mudanças de fila e atribuições aparecerão aqui."
            />
          ) : (
            <ol className="space-y-4 border-l pl-4">
              {history.data.map((h) => (
                <li key={h.type + h.id} className="space-y-1 text-sm">
                  <p className="font-medium">
                    {h.type === 'assignment'
                      ? `Responsável: ${h.assigned_to_name ?? 'sem responsável'}`
                      : `${h.from_status ? QUEUE_LABELS[h.from_status] : 'Sem fila'} → ${h.to_status ? QUEUE_LABELS[h.to_status] : 'Sem fila'}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {h.changed_by_name ?? 'Sistema'} ·{' '}
                    {h.type === 'assignment' ? 'Atribuição' : (reasons[h.reason ?? ''] ?? h.reason)}
                  </p>
                  <time dateTime={h.created_at} className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString('pt-BR', {
                      timeZone: me.data?.preferences.timezone,
                      timeZoneName: 'short',
                    })}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
