import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RotateCw, Trash2 } from 'lucide-react';
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

type Token = {
  id: string;
  name: string;
  permission: string;
  user_ids: string[];
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  expired: boolean;
};
type TokenList = {
  tenant: { id: string; name: string };
  tokens: Token[];
  users: { id: string; full_name: string; email: string }[];
};
type IssuedToken = { token: string; name: string; expires_at: string };
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR');

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
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [action, setAction] = useState<{ token: Token; kind: 'rotate' | 'revoke' } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!users.length) {
      setError('Selecione ao menos um usuário autorizado.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<IssuedToken>('/integrations/api-tokens', {
        method: 'POST',
        body: { name, user_ids: users, expires_in_days: days },
      });
      setCreate(false);
      setIssued(result);
      setName('');
      setUsers([]);
      setSearch('');
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
      await api(`/integrations/api-tokens/${token.id}`, { method: 'DELETE' });
      toast.success('Token revogado.');
    }
    setAction(null);
    await client.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrações"
        description="Tokens de API para consultar notificações entre sistemas."
      />
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="size-4" />
              Tokens de API
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query.data?.tenant.name} · Somente leitura de notificações
            </p>
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
          Autorize os usuários que cada integração poderá consultar. Guarde o token no servidor do
          sistema integrado. O acesso às caixas continua seguindo as permissões de cada usuário.
        </p>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : !query.data.tokens.length ? (
          <EmptyState
            icon={KeyRound}
            title="Nenhum token criado"
            description="Crie um token para conectar o indicador de e-mails do seu sistema ao APMail."
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
                        {token.revoked_at ? 'Revogado' : expired ? 'Expirado' : 'Ativo'}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.user_ids.length}{' '}
                      {token.user_ids.length === 1 ? 'usuário autorizado' : 'usuários autorizados'}{' '}
                      · Validade até {date(token.expires_at)}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">notifications:read</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {query.data.users
                        .filter((user) => token.user_ids.includes(user.id))
                        .map((user) => user.full_name)
                        .join(', ')}
                    </p>
                  </div>
                  {!token.revoked_at && (
                    <div className="flex gap-2">
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
              Empresa {query.data?.tenant.name}. Permissão de leitura de notificações.
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
                placeholder="Integração Curciol"
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
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Usuários autorizados ({users.length})</legend>
              <Input
                aria-label="Pesquisar usuários autorizados"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar nome ou e-mail"
              />
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                {query.data?.users
                  .filter((user) =>
                    `${user.full_name} ${user.email}`.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((user) => (
                    <label
                      key={user.id}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={users.includes(user.id)}
                        onChange={(event) =>
                          setUsers((current) =>
                            event.target.checked
                              ? [...current, user.id]
                              : current.filter((id) => id !== user.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {user.full_name}
                        <span className="block text-xs text-muted-foreground">{user.email}</span>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
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
              <Button disabled={busy || !name.trim() || !users.length}>
                {busy ? 'Criando…' : 'Criar token'}
              </Button>
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
          <p className="text-sm text-muted-foreground">
            Validade até {issued && date(issued.expires_at)}.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIssued(null)}>
              Fechar
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
      <ConfirmDialog
        open={!!action}
        onOpenChange={(open) => !open && setAction(null)}
        title={action?.kind === 'rotate' ? 'Renovar token?' : 'Revogar token?'}
        description={
          action?.kind === 'rotate'
            ? 'O token anterior perde o acesso imediatamente. O novo token terá validade de 90 dias. Atualize-o no sistema integrado.'
            : 'O sistema integrado perderá imediatamente o acesso às notificações por este token.'
        }
        destructive
        onConfirm={confirm}
      />
    </div>
  );
}
