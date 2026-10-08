import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { personalLabelSchema, isTenantAdmin, type ListQuery } from '@apmail/shared';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useTenantId, type Mailbox } from '@/lib/auth';
import type { PersonalLabel } from '@/lib/organization';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
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
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ColorPicker } from '@/components/forms/color-picker';
import { LabelBadge } from './label-badge';
export function LabelsSettings({
  query,
  onQueryChange,
}: {
  query: ListQuery;
  onQueryChange: (query: ListQuery) => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery).data;
  const boxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const admin = isTenantAdmin(me?.tenants.find((t) => t.id === tenant)?.role);
  const q = useQuery({
    queryKey: ['labels', tenant, me?.user.id],
    queryFn: () => api<PersonalLabel[]>('/labels'),
  });
  const [draft, setDraft] = useState<PersonalLabel | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const invalidate = () =>
    Promise.all(
      ['labels', 'threads', 'thread', 'global-search'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  return (
    <>
      <PageHeader
        title="Etiquetas"
        description="Etiquetas pessoais são privadas. Etiquetas globais organizam as conversas para toda a equipe."
        actions={
          <Button
            onClick={() => {
              setDraft({
                id: '',
                name: '',
                color: '#1686A7',
                scope: 'personal',
                mailbox_mode: 'all',
                mailbox_ids: [],
              });
              setError('');
            }}
          >
            <Plus />
            Nova etiqueta
          </Button>
        }
      />
      <ConfigurableTable
        listKey="labels"
        mode="client"
        groupBy={(l) => (l.scope === 'tenant' ? 0 : 1)}
        data={q.data ?? []}
        query={query}
        onQueryChange={onQueryChange}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          {
            id: 'name',
            header: 'Nome',
            hideable: false,
            sortable: true,
            cell: (l) => <LabelBadge label={l} />,
          },
          {
            id: 'scope',
            header: 'Tipo',
            cell: (l) => (l.scope === 'tenant' ? 'Global da empresa' : 'Pessoal'),
          },
          {
            id: 'color',
            header: 'Cor',
            cell: (l) => <span className="font-mono text-xs">{l.color}</span>,
          },
          { id: 'thread_count', header: 'Conversas acessíveis', align: 'right', sortable: true },
        ]}
        rowActions={(l) =>
          l.scope !== 'tenant' || admin ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={'Editar etiqueta ' + l.name}
                onClick={() => {
                  setDraft({ ...l });
                  setError('');
                }}
              >
                <Pencil />
              </Button>
              <ConfirmDialog
                title="Excluir etiqueta?"
                description={
                  l.scope === 'tenant'
                    ? 'A etiqueta global ' +
                      l.name +
                      ' será removida de todas as conversas da empresa.'
                    : 'A etiqueta ' + l.name + ' será removida apenas das suas conversas.'
                }
                destructive
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={'Excluir etiqueta ' + l.name}
                  >
                    <Trash2 />
                  </Button>
                }
                onConfirm={async () => {
                  await api('/labels/' + l.id, { method: 'DELETE' });
                  await invalidate();
                  toast.success('Etiqueta excluída.');
                }}
              />
            </>
          ) : null
        }
      />
      <Dialog
        open={!!draft}
        onOpenChange={(v) => {
          if (!v && !busy) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar etiqueta' : 'Nova etiqueta'}</DialogTitle>
            <DialogDescription>Escolha nome, cor e disponibilidade da etiqueta.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setError('');
                const parsed = personalLabelSchema.safeParse(draft);
                if (!parsed.success) {
                  setError(parsed.error.issues.map((i) => i.message).join(' '));
                  return;
                }
                setBusy(true);
                try {
                  await api('/labels' + (draft.id ? '/' + draft.id : ''), {
                    method: draft.id ? 'PATCH' : 'POST',
                    body: parsed.data,
                  });
                  await invalidate();
                  setDraft(null);
                  toast.success('Etiqueta salva.');
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="label-name">Nome *</Label>
                <Input
                  id="label-name"
                  value={draft.name}
                  maxLength={40}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="label-scope">Disponibilidade</Label>
                <select
                  id="label-scope"
                  className="h-11 w-full rounded-md border bg-card px-3 text-sm"
                  value={draft.scope ?? 'personal'}
                  disabled={!!draft.id || !admin}
                  onChange={(e) =>
                    setDraft({ ...draft, scope: e.target.value as 'personal' | 'tenant' })
                  }
                >
                  <option value="personal">Pessoal — somente você</option>
                  {(admin || draft.scope === 'tenant') && (
                    <option value="tenant">Global da empresa — toda a equipe</option>
                  )}
                </select>
              </div>
              <div className="space-y-3">
                <Label htmlFor="label-mailbox-mode">Caixas onde a etiqueta vale</Label>
                <select
                  id="label-mailbox-mode"
                  className="h-11 w-full rounded-md border bg-card px-3 text-sm"
                  value={draft.mailbox_mode ?? 'all'}
                  onChange={(e) =>
                    setDraft({ ...draft, mailbox_mode: e.target.value as 'all' | 'selected' })
                  }
                >
                  <option value="all">Todas as caixas elegíveis (inclui novas)</option>
                  <option value="selected">Selecionar caixas</option>
                </select>
                {draft.mailbox_mode === 'selected' &&
                  (boxes.data ?? []).map((box) => (
                    <label key={box.id} className="flex min-h-11 items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.mailbox_ids?.includes(box.id) ?? false}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            mailbox_ids: checked
                              ? [...(draft.mailbox_ids ?? []), box.id]
                              : (draft.mailbox_ids ?? []).filter((id) => id !== box.id),
                          })
                        }
                      />
                      {box.name} ({box.email_address})
                    </label>
                  ))}
                {draft.id && (
                  <p className="text-xs text-muted-foreground">
                    Ao retirar uma caixa, aplicações antigas ficam ocultas e regras afetadas são
                    desativadas para revisão.
                  </p>
                )}
              </div>
              <ColorPicker
                value={draft.color}
                onChange={(color) => setDraft({ ...draft, color })}
              />
              <div className="space-y-2">
                <p className="text-sm font-medium">Prévia</p>
                <LabelBadge label={{ ...draft, name: draft.name || 'Nova etiqueta' }} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancelar
                </Button>
                <Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar etiqueta'}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
