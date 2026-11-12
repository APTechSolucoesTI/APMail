import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RotateCw, Trash2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/data/data-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  ApiTokenAccess,
  type ApiRoute,
  type ApiUser,
  type ApiMailbox,
  type TokenAccess,
} from './api-token-access';

type Token = {
  id: string;
  name: string;
  permissions: string[];
  user_ids: string[];
  mailbox_ids: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  expired: boolean;
};
type TokenList = {
  tenant: { id: string; name: string };
  tokens: Token[];
  users: ApiUser[];
  routes: ApiRoute[];
  mailboxes: ApiMailbox[];
};
type IssuedToken = {
  id: string;
  token: string;
  name: string;
  expires_at: string | null;
  permissions: string[];
};
const validity = (value: string | null) =>
  value ? 'Validade até ' + new Date(value).toLocaleDateString('pt-BR') : 'Validade ilimitada';

export function ApiTokens() {
  const tenant = useTenantId();
  return <ApiTokensForTenant key={tenant} />;
}

function ApiTokensForTenant() {
  const tenant = useTenantId();
  const client = useQueryClient();
  const key = ['integration-api-tokens', tenant];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<TokenList>('/integrations/api-tokens'),
    refetchInterval: 60000,
  });
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [access, setAccess] = useState<TokenAccess | null>(null);
  const [action, setAction] = useState<{
    token: Token;
    kind: 'rotate' | 'revoke' | 'delete';
  } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<IssuedToken>('/integrations/api-tokens', {
        method: 'POST',
        body: { name, expires_in_days: days === 0 ? null : days },
      });
      setCreate(false);
      setIssued(result);
      setName('');
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar o token.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!action) return;
    const { token, kind } = action;
    if (kind === 'rotate') {
      setIssued(
        await api<IssuedToken>(`/integrations/api-tokens/${token.id}/rotate`, {
          method: 'POST',
          body: {},
        }),
      );
    } else {
      await api(`/integrations/api-tokens/${token.id}${kind === 'delete' ? '/permanent' : ''}`, {
        method: 'DELETE',
      });
      toast.success(kind === 'delete' ? 'Token excluído.' : 'Token revogado.');
    }
    setAction(null);
    await client.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrações"
        description="Chaves de acesso para conectar seus sistemas ao APMail."
      />
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="size-4" />
              Tokens de API
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{query.data?.tenant.name}</p>
          </div>
          <Button
            onClick={() => {
              setError('');
              setCreate(true);
            }}
            disabled={!query.data}
          >
            <Plus />
            Criar token
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Crie uma chave para sua integração e depois configure as rotas que ela pode acessar.
          Guarde a chave no servidor do sistema integrado.
        </p>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : !query.data.tokens.length ? (
          <EmptyState
            icon={KeyRound}
            title="Nenhum token criado"
            description="Crie uma chave e configure os acessos da sua integração."
          />
        ) : (
          <ul className="divide-y">
            {query.data.tokens.map((token) => {
              const expired = token.expired;
              return (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-sm font-medium">
                      {token.name}{' '}
                      <Badge variant="outline">
                        {token.revoked_at
                          ? 'Revogado'
                          : expired
                            ? 'Expirado'
                            : token.permissions.length
                              ? 'Ativo'
                              : 'Sem acessos'}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.user_ids.length}{' '}
                      {token.user_ids.length === 1 ? 'usuário autorizado' : 'usuários autorizados'}{' '}
                      · {validity(token.expires_at)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.permissions.length
                        ? [
                            ...new Set(
                              query.data.routes
                                .filter((route) => token.permissions.includes(route.permission))
                                .map((route) => route.name),
                            ),
                          ].join(', ')
                        : 'Nenhuma rota autorizada'}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {query.data.users
                        .filter((user) => token.user_ids.includes(user.id))
                        .map((user) => user.full_name)
                        .join(', ')}
                    </p>
                  </div>
                  {!token.revoked_at ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setAccess(token)}>
                        <SlidersHorizontal />
                        Acessos
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAction({ token, kind: 'rotate' })}
                      >
                        <RotateCw />
                        Renovar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setAction({ token, kind: 'revoke' })}
                      >
                        <Trash2 />
                        Revogar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setAction({ token, kind: 'delete' })}
                    >
                      <Trash2 />
                      Excluir
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Dialog open={create} onOpenChange={(open) => !busy && setCreate(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar token de API</DialogTitle>
            <DialogDescription>
              Empresa {query.data?.tenant.name}. Depois de criar, configure as rotas autorizadas.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-token-name">Nome da integração</Label>
              <Input
                id="api-token-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                autoFocus
                placeholder="Escreva o nome da sua integração aqui…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-token-expiry">Validade</Label>
              <select
                id="api-token-expiry"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="h-9 w-full rounded-md border bg-card px-3 text-sm"
              >
                {[30, 90, 365].map((value) => (
                  <option key={value} value={value}>
                    {value} dias
                  </option>
                ))}
                <option value={0}>Ilimitada</option>
              </select>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setCreate(false)}
              >
                Cancelar
              </Button>
              <Button disabled={busy || !name.trim()}>{busy ? 'Criando…' : 'Criar token'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!issued} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token gerado</DialogTitle>
            <DialogDescription>
              Copie agora e armazene no backend da integração. Ao fechar esta janela, o segredo
              deixa de ser exibido.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="api-token-secret">{issued?.name}</Label>
          <Input
            id="api-token-secret"
            value={issued?.token ?? ''}
            readOnly
            className="font-mono"
            onFocus={(event) => event.target.select()}
          />
          <p className="text-sm text-muted-foreground">{issued && validity(issued.expires_at)}.</p>
          {!issued?.permissions.length && (
            <p className="text-sm text-muted-foreground">
              Configure os acessos para liberar as rotas desta chave.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setIssued(null)}>
              Fechar
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!issued) return;
                const existing = query.data?.tokens.find((token) => token.id === issued.id);
                setAccess(
                  existing ?? {
                    id: issued.id,
                    name: issued.name,
                    permissions: issued.permissions,
                    user_ids: [],
                    mailbox_ids: [],
                  },
                );
                setIssued(null);
              }}
            >
              Configurar acessos
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(issued!.token);
                  toast.success('Token copiado.');
                } catch {
                  toast.error('Selecione o token e copie usando o teclado.');
                }
              }}
            >
              <Copy />
              Copiar token
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {access && query.data && (
        <ApiTokenAccess
          key={access.id}
          token={access}
          routes={query.data.routes}
          users={query.data.users}
          mailboxes={query.data.mailboxes}
          onClose={() => setAccess(null)}
          onSaved={async () => {
            await client.invalidateQueries({ queryKey: key });
            toast.success('Acessos atualizados.');
          }}
        />
      )}
      <ConfirmDialog
        open={!!action}
        onOpenChange={(open) => !open && setAction(null)}
        title={
          action?.kind === 'rotate'
            ? 'Renovar token?'
            : action?.kind === 'delete'
              ? 'Excluir token?'
              : 'Revogar token?'
        }
        description={
          action?.kind === 'rotate'
            ? 'O token anterior perde o acesso imediatamente. O novo token terá validade ' +
              (action.token.expires_at === null ? 'ilimitada' : 'de 90 dias') +
              '. Atualize-o no sistema integrado.'
            : action?.kind === 'delete'
              ? 'O token revogado e suas autorizações serão removidos definitivamente. Confirme para excluir.'
              : 'O sistema integrado perderá imediatamente o acesso às rotas autorizadas por este token.'
        }
        destructive
        onConfirm={confirm}
      />
    </div>
  );
}
