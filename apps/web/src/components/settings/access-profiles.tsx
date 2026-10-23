import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Copy, Trash2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { accessProfileSchema, ROLE_LABELS, type AccessProfile } from '@apmail/shared';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { TeamNavigation } from './team-navigation';
import { PermissionPicker } from './permission-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/data/pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';

type ProfileInput = z.infer<typeof accessProfileSchema>;
export function AccessProfiles() {
  const tenantId = useTenantId(),
    client = useQueryClient();
  const q = useQuery({
    queryKey: ['access-profiles', tenantId],
    queryFn: () => api<AccessProfile[]>('/access-profiles'),
  });
  const [editing, setEditing] = useState<{ id?: string; values: ProfileInput } | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10);
  const refresh = () => client.invalidateQueries({ queryKey: ['access-profiles', tenantId] });
  const blank = () => setEditing({ values: { name: '', description: '', permissions: [] } });
  const rows =
    q.data?.filter((p) =>
      (p.name + ' ' + p.description)
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
    ) ?? [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  return (
    <>
      <PageHeader
        title="Perfis de acesso"
        description="Defina as telas e ações disponíveis para cada função da equipe."
        actions={
          <Button onClick={blank}>
            <Plus className="size-4" />
            Criar perfil
          </Button>
        }
      />
      <TeamNavigation />
      <div className="mb-5 rounded-lg border bg-card p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" />
          Permissões por função
        </div>
        <p className="mt-1 text-muted-foreground">
          Crie um perfil e atribua-o ao convidar ou editar um usuário. O perfil limita módulos e
          ações; caixas e pastas continuam com acesso individual. Perfis do sistema são protegidos:
          duplique um deles para criar uma versão personalizada. Exceções individuais ficam em
          Permissões por usuário.
        </p>
      </div>
      <div className="mb-3 max-w-sm space-y-1">
        <Label htmlFor="profile-search">Buscar perfis</Label>
        <Input
          id="profile-search"
          placeholder="Nome ou descrição"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !rows.length ? (
        <EmptyState
          title={search ? 'Nenhum perfil encontrado' : 'Nenhum perfil de acesso'}
          description={
            search
              ? 'Ajuste a busca para encontrar um perfil.'
              : 'Crie um perfil com as permissões necessárias para sua equipe.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1">
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
            />
            <label className="flex items-center gap-2 px-2 text-xs">
              Por página
              <select
                aria-label="Perfis por página"
                className="h-9 rounded-md border bg-background px-2 sm:h-8"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 20, 30, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {rows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((p) => (
            <article
              key={p.id}
              className="flex flex-col gap-3 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">
                    {p.system_role ? ROLE_LABELS[p.system_role] : p.name}
                  </h2>
                  {p.system_role && <Badge variant="secondary">Perfil do sistema</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.description || 'Sem descrição.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{p.permissions.length} permissões</Badge>
                  <span className="text-xs text-muted-foreground">
                    {p.member_count} usuários · {p.invitation_count} convites pendentes
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {!p.system_role && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={'Editar perfil ' + p.name}
                    onClick={() => setEditing({ id: p.id, values: p })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={'Duplicar perfil ' + p.name}
                  onClick={() =>
                    setEditing({ values: { ...p, name: p.name.slice(0, 65) + ' — cópia' } })
                  }
                >
                  <Copy className="size-4" />
                </Button>
                {!p.system_role && (
                  <ConfirmDialog
                    destructive
                    title="Excluir perfil de acesso?"
                    description="Só é possível excluir um perfil sem usuários ou convites pendentes. O histórico das alterações será preservado."
                    trigger={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={'Excluir perfil ' + p.name}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    }
                    onConfirm={async () => {
                      await api('/access-profiles/' + p.id, { method: 'DELETE' });
                      await refresh();
                      toast.success('Perfil excluído.');
                    }}
                  />
                )}
              </div>
            </article>
          ))}
          <Pagination
            page={currentPage}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
          />
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Editar perfil' : 'Criar perfil de acesso'}</DialogTitle>
            <DialogDescription>
              As alterações passam a valer para usuários que herdam este perfil. Exceções
              individuais são preservadas. Sem permissões selecionadas, apenas perfil pessoal e
              preferências ficam disponíveis.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <ProfileForm
              key={editing.id ?? editing.values.name}
              initial={editing.values}
              onCancel={() => setEditing(null)}
              onSave={async (values) => {
                await api('/access-profiles' + (editing.id ? '/' + editing.id : ''), {
                  method: editing.id ? 'PUT' : 'POST',
                  body: values,
                });
                await refresh();
                setEditing(null);
                toast.success('Perfil de acesso salvo.');
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ProfileForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ProfileInput;
  onSave: (v: ProfileInput) => Promise<void>;
  onCancel: () => void;
}) {
  const me = useQuery(meQuery).data,
    tenant = me?.tenants.find((t) => t.id === me.current_tenant_id);
  const form = useForm<z.input<typeof accessProfileSchema>, unknown, ProfileInput>({
    resolver: zodResolver(accessProfileSchema),
    defaultValues: initial,
  });
  const selected = useWatch({ control: form.control, name: 'permissions' }),
    busy = form.formState.isSubmitting;
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (v) => {
        setError('');
        try {
          await onSave(v);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="profile-name">Nome do perfil</Label>
          <Input
            id="profile-name"
            autoFocus
            maxLength={80}
            disabled={busy}
            {...form.register('name')}
            aria-invalid={!!form.formState.errors.name}
          />
          {form.formState.errors.name && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-description">Descrição</Label>
          <Textarea
            id="profile-description"
            maxLength={300}
            disabled={busy}
            {...form.register('description')}
            rows={2}
          />
        </div>
      </div>
      <PermissionPicker
        value={selected}
        onChange={(permissions) => form.setValue('permissions', permissions, { shouldDirty: true })}
        allowedPermissions={tenant?.access_permissions}
        disabled={busy}
      />
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background pt-3">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar perfil'}
        </Button>
      </div>
    </form>
  );
}
