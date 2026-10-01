import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { Plus, Pencil, Trash2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { signatureSchema, listQuerySchema } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, type Mailbox } from '@/lib/auth';
import type { Signature } from '@/lib/outbox';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { RichTextEditor } from '@/components/forms/rich-text-editor';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export const Route = createFileRoute('/_app/settings/signatures')({
  validateSearch: listQuerySchema,
  component: Signatures,
});
function Signatures() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    search = Route.useSearch(),
    navigate = Route.useNavigate();
  const q = useQuery({
      queryKey: ['signatures', tenant],
      queryFn: () => api<Signature[]>('/signatures'),
    }),
    boxes = useQuery({
      queryKey: ['mailboxes', tenant],
      queryFn: () => api<Mailbox[]>('/mailboxes'),
    });
  const [draft, setDraft] = useState<Signature | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <PageHeader
        title="Assinaturas"
        description="Personalize sua assinatura por caixa ou para todas as caixas."
        actions={
          <Button
            onClick={() => {
              setError('');
              setDraft({ id: '', name: '', mailbox_id: null, body_html: '', is_default: false });
            }}
          >
            <Plus />
            Nova assinatura
          </Button>
        }
      />
      <ConfigurableTable
        listKey="signatures"
        mode="client"
        data={q.data ?? []}
        query={search}
        onQueryChange={(search) => void navigate({ search })}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          { id: 'name', header: 'Nome', sortable: true, hideable: false },
          {
            id: 'mailbox_id',
            header: 'Caixa',
            cell: (s) =>
              s.mailbox_id
                ? (boxes.data?.find((b) => b.id === s.mailbox_id)?.name ?? 'Caixa indisponível')
                : 'Todas as caixas',
          },
          {
            id: 'is_default',
            header: 'Padrão',
            cell: (s) =>
              s.is_default ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-4" />
                  Sim
                </span>
              ) : (
                'Não'
              ),
          },
        ]}
        rowActions={(s) => (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={'Editar ' + s.name}
              onClick={() => {
                setError('');
                setDraft(s);
              }}
            >
              <Pencil />
            </Button>
            <ConfirmDialog
              title="Excluir assinatura?"
              description="Ela deixará de ser oferecida para novos e-mails."
              trigger={
                <Button variant="ghost" size="icon" aria-label={'Excluir ' + s.name}>
                  <Trash2 />
                </Button>
              }
              onConfirm={async () => {
                await api('/signatures/' + s.id, { method: 'DELETE' });
                await q.refetch();
                toast.success('Assinatura excluída.');
              }}
            />
          </>
        )}
      />
      <Dialog
        open={!!draft}
        onOpenChange={(v) => {
          if (!v && !busy) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar assinatura' : 'Nova assinatura'}</DialogTitle>
            <DialogDescription>Imagens devem usar endereços HTTPS.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const body = signatureSchema.parse({
                    ...draft,
                    body_html: DOMPurify.sanitize(draft.body_html),
                  });
                  await api(draft.id ? '/signatures/' + draft.id : '/signatures', {
                    method: draft.id ? 'PATCH' : 'POST',
                    body,
                  });
                  await client.invalidateQueries({ queryKey: ['signatures', tenant] });
                  setDraft(null);
                  toast.success('Assinatura salva.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Label htmlFor="signature-name">Nome</Label>
              <Input
                id="signature-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
              <Label htmlFor="signature-mailbox">Caixa</Label>
              <select
                id="signature-mailbox"
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={draft.mailbox_id ?? ''}
                onChange={(e) => setDraft({ ...draft, mailbox_id: e.target.value || null })}
              >
                <option value="">Todas as caixas</option>
                {boxes.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Label>Conteúdo da assinatura</Label>
              <RichTextEditor
                label="Conteúdo da assinatura"
                value={draft.body_html}
                onChange={(body_html) => setDraft({ ...draft, body_html })}
                images
              />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.is_default}
                  onCheckedChange={(v) => setDraft({ ...draft, is_default: v === true })}
                />
                Definir como padrão
              </label>
              <div className="rounded-md border bg-card p-4 text-sm">
                <p className="mb-2 font-semibold">Pré-visualização</p>
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(draft.body_html) }} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar assinatura'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
