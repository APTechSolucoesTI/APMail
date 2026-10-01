import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { personalLabelSchema, listQuerySchema, LABEL_COLORS } from '@apmail/shared';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { LABEL_COLOR_NAMES, type PersonalLabel } from '@/lib/organization';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SchemaForm } from '@/components/forms/schema-form';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { LabelBadge } from '@/components/mail/label-badge';
export const Route = createFileRoute('/_app/settings/labels')({
  validateSearch: listQuerySchema,
  component: Labels,
});
function Labels() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    query = Route.useSearch(),
    navigate = Route.useNavigate(),
    q = useQuery({ queryKey: ['labels', tenant], queryFn: () => api<PersonalLabel[]>('/labels') });
  const [draft, setDraft] = useState<PersonalLabel | null>(null);
  return (
    <>
      <PageHeader
        title="Etiquetas"
        description="Suas etiquetas são visíveis apenas para você, nesta empresa."
        actions={
          <Button onClick={() => setDraft({ id: '', name: '', color: 'teal' })}>
            <Plus />
            Nova etiqueta
          </Button>
        }
      />
      <ConfigurableTable
        listKey="labels"
        mode="client"
        data={q.data ?? []}
        query={query}
        onQueryChange={(search) => void navigate({ search })}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          { id: 'name', header: 'Nome', hideable: false, sortable: true },
          {
            id: 'color',
            header: 'Cor',
            cell: (l) => <LabelBadge label={{ ...l, name: LABEL_COLOR_NAMES[l.color] }} />,
          },
          { id: 'thread_count', header: 'Conversas', align: 'right', sortable: true },
        ]}
        rowActions={(l) => (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={'Editar etiqueta ' + l.name}
              onClick={() => setDraft(l)}
            >
              <Pencil />
            </Button>
            <ConfirmDialog
              title="Excluir etiqueta?"
              description={'A etiqueta ' + l.name + ' será removida das suas conversas.'}
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
                await client.invalidateQueries({ queryKey: ['labels'] });
                toast.success('Etiqueta excluída.');
              }}
            />
          </>
        )}
      />
      <Dialog
        open={!!draft}
        onOpenChange={(v) => {
          if (!v) setDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar etiqueta' : 'Nova etiqueta'}</DialogTitle>
            <DialogDescription>
              Escolha um nome e uma cor para organizar suas conversas.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <SchemaForm
              key={draft.id}
              schema={personalLabelSchema}
              defaults={{ ...draft }}
              fields={[
                { name: 'name', label: 'Nome' },
                {
                  name: 'color',
                  label: 'Cor',
                  type: 'select',
                  options: LABEL_COLORS.map((value) => ({
                    value,
                    label: LABEL_COLOR_NAMES[value],
                  })),
                },
              ]}
              renderPreview={(v) => (
                <LabelBadge
                  label={{
                    id: '',
                    name: String(v.name || 'Prévia'),
                    color: personalLabelSchema.shape.color.parse(v.color),
                  }}
                />
              )}
              cancelLabel="Cancelar"
              onSubmit={async (body) => {
                await api('/labels' + (draft.id ? '/' + draft.id : ''), {
                  method: draft.id ? 'PATCH' : 'POST',
                  body,
                });
                await client.invalidateQueries({ queryKey: ['labels'] });
                setDraft(null);
                toast.success('Etiqueta salva.');
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
