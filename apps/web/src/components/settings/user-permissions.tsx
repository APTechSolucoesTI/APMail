import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasAccess,
  isTenantAdmin,
  ROLE_LABELS,
  type AccessPermission,
  type TenantRole,
} from '@apmail/shared';
import { UserRoundCog, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useAccess, useTenantId } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
} from '@/components/data/data-state';
import { TeamNavigation } from './team-navigation';
import { PermissionPicker } from './permission-picker';

type Member = {
  user_id: string;
  full_name: string;
  email: string;
  role: TenantRole;
  status: 'active' | 'disabled';
};
type UserPermissionAccess = {
  access_profile_id: string | null;
  profile_name: string;
  base_permissions: AccessPermission[];
  permissions: AccessPermission[];
  customized: boolean;
};

export function UserPermissions() {
  const tenantId = useTenantId();
  const client = useQueryClient();
  const canManage = useAccess('users.manage');
  const me = useQuery(meQuery).data;
  const actor = me?.tenants.find((tenant) => tenant.id === me.current_tenant_id);
  const members = useQuery({
    queryKey: ['members', tenantId],
    queryFn: ({ signal }) => api<{ members: Member[] }>('/members', { signal }),
    enabled: canManage,
  });
  const [selectedId, setSelectedId] = useState('');
  const member = members.data?.members.find((candidate) => candidate.user_id === selectedId);
  const protectedRole = isTenantAdmin(member?.role);
  const permissions = useQuery({
    queryKey: ['user-permissions', tenantId, selectedId],
    queryFn: ({ signal }) =>
      api<UserPermissionAccess>('/members/' + selectedId + '/permissions', { signal }),
    enabled: canManage && !!member && !protectedRole,
    refetchOnWindowFocus: false,
  });
  async function save(value: AccessPermission[] | null) {
    await api('/members/' + selectedId + '/permissions', {
      method: 'PUT',
      body: { permissions: value },
    });
    await Promise.all([
      client.invalidateQueries({ queryKey: ['user-permissions', tenantId, selectedId] }),
      client.invalidateQueries({ queryKey: ['members', tenantId] }),
      client.invalidateQueries({ queryKey: ['me'] }),
    ]);
    toast.success(
      value === null ? 'Permissões do perfil restauradas.' : 'Permissões do usuário salvas.',
    );
  }
  return (
    <>
      <PageHeader
        title="Permissões por usuário"
        description="Ajuste exceções individuais a partir das permissões do perfil atribuído."
      />
      <TeamNavigation />
      {!canManage ? (
        <NoPermissionState />
      ) : members.isPending ? (
        <LoadingState />
      ) : members.isError ? (
        <ErrorState onRetry={() => void members.refetch()} />
      ) : !members.data.members.length ? (
        <EmptyState
          title="Nenhum usuário disponível"
          description="Os usuários da empresa aparecerão aqui após entrarem na equipe."
        />
      ) : (
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="space-y-2 sm:max-w-xl">
              <Label htmlFor="permission-user">Usuário</Label>
              <select
                id="permission-user"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
              >
                <option value="">Selecione um usuário</option>
                {members.data.members.map((candidate) => (
                  <option key={candidate.user_id} value={candidate.user_id}>
                    {candidate.full_name} ({candidate.email})
                    {candidate.status === 'disabled' ? ' · Desativado' : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              As alterações afetam somente este usuário. Sem exceções, ele acompanha as permissões
              do perfil. O acesso a caixas e pastas continua sendo configurado na equipe.
            </p>
          </section>
          {!member ? (
            <EmptyState
              icon={UserRoundCog}
              title="Selecione um usuário"
              description="Consulte o perfil atual e selecione as ações que essa pessoa pode realizar."
            />
          ) : protectedRole ? (
            <section className="rounded-lg border bg-card p-4" role="status">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="size-4 text-primary" />
                Perfil protegido pelo sistema
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {member.full_name} possui o perfil {ROLE_LABELS[member.role]}. Proprietários e
                administradores mantêm seus acessos de administração e não recebem exceções
                individuais.
              </p>
            </section>
          ) : permissions.isPending ? (
            <LoadingState />
          ) : permissions.isError ? (
            <ErrorState onRetry={() => void permissions.refetch()} />
          ) : (
            <UserPermissionForm
              key={
                selectedId +
                ':' +
                permissions.data.customized +
                ':' +
                permissions.data.permissions.join(',')
              }
              member={member}
              access={permissions.data}
              allowedPermissions={actor?.access_permissions}
              canSave={hasAccess(actor, 'users.manage')}
              onSave={save}
            />
          )}
        </div>
      )}
    </>
  );
}

function UserPermissionForm({
  member,
  access,
  allowedPermissions,
  canSave,
  onSave,
}: {
  member: Member;
  access: UserPermissionAccess;
  allowedPermissions?: readonly string[] | null;
  canSave: boolean;
  onSave: (value: AccessPermission[] | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState<AccessPermission[]>([
    ...(access.customized ? access.permissions : access.base_permissions),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const added = selected.filter(
    (permission) => !access.base_permissions.includes(permission),
  ).length;
  const removed = access.base_permissions.filter(
    (permission) => !selected.includes(permission),
  ).length;
  const dirty = [...selected].sort().join(',') !== [...access.permissions].sort().join(',');
  async function persist(value: AccessPermission[] | null) {
    setError('');
    setBusy(true);
    try {
      await onSave(value);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar as permissões. Tente novamente.',
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="rounded-lg border bg-card p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && dirty && canSave) void persist(selected).catch(() => undefined);
      }}
    >
      <div className="mb-5 space-y-3 border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{member.full_name}</h2>
            <p className="break-all text-sm text-muted-foreground">{member.email}</p>
          </div>
          <Badge variant={access.customized ? 'secondary' : 'outline'}>
            {access.customized ? 'Permissões personalizadas' : 'Herdando do perfil'}
          </Badge>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Perfil atribuído: </span>
          <strong className="font-semibold">{access.profile_name}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          {access.customized
            ? 'Este usuário usa uma cópia personalizada. Alterações futuras no perfil só serão herdadas após restaurar as permissões.'
            : 'As seleções abaixo foram copiadas do perfil. Salvar uma alteração cria uma exceção individual.'}
        </p>
        {(added > 0 || removed > 0) && (
          <p className="text-sm text-muted-foreground">
            Em relação ao perfil: {added} adicionadas · {removed} removidas
          </p>
        )}
      </div>
      <PermissionPicker
        value={selected}
        onChange={setSelected}
        allowedPermissions={allowedPermissions}
        disabled={busy || !canSave}
      />
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="sticky bottom-0 mt-5 flex flex-wrap justify-end gap-2 border-t bg-card pt-4">
        <ConfirmDialog
          title="Restaurar permissões do perfil?"
          description="As exceções individuais serão removidas. O usuário voltará a acompanhar as permissões atuais e futuras do perfil atribuído."
          pending={busy}
          onConfirm={() => persist(null)}
          trigger={
            <Button
              type="button"
              variant="outline"
              disabled={busy || !canSave || !access.customized}
            >
              Restaurar permissões do perfil
            </Button>
          }
        />
        <Button type="submit" disabled={busy || !canSave || !dirty}>
          {busy ? 'Salvando…' : 'Salvar permissões do usuário'}
        </Button>
      </div>
    </form>
  );
}
