import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type ApiRoute = {
  permission: string;
  name: string;
  description: string;
  method: string;
  path: string;
};
export type TokenAccess = {
  id: string;
  name: string;
  permissions: string[];
  user_ids: string[];
  mailbox_ids: string[];
};
export type ApiUser = { id: string; full_name: string; email: string };
export type ApiMailbox = { id: string; name: string; email_address: string };

export function ApiTokenAccess({
  token,
  routes,
  users,
  mailboxes,
  onClose,
  onSaved,
}: {
  token: TokenAccess;
  routes: ApiRoute[];
  users: ApiUser[];
  mailboxes: ApiMailbox[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [permissions, setPermissions] = useState(token.permissions);
  const [selected, setSelected] = useState(() =>
    token.user_ids.filter((id) => users.some((user) => user.id === id)),
  );
  const [search, setSearch] = useState('');
  const [boxes, setBoxes] = useState(
    token.mailbox_ids.filter((id) => mailboxes.some((box) => box.id === id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsUsers = permissions.length > 0;
  const needsBoxes = permissions.some((p) => p === 'messages:read' || p === 'attachments:download');
  const visibleUsers = users.filter((user) =>
    `${user.full_name} ${user.email}`.toLowerCase().includes(search.toLowerCase()),
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/integrations/api-tokens/${token.id}/access`, {
        method: 'PUT',
        body: { permissions, user_ids: selected, mailbox_ids: needsBoxes ? boxes : [] },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar os acessos.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configurar acessos</DialogTitle>
          <DialogDescription>
            {token.name}. Escolha as rotas que esta chave pode acessar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Rotas autorizadas</legend>
            {routes.map((route) => (
              <label
                key={route.permission}
                className="flex cursor-pointer gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={permissions.includes(route.permission)}
                  onChange={(event) =>
                    setPermissions((current) =>
                      event.target.checked
                        ? [...current, route.permission]
                        : current.filter((permission) => permission !== route.permission),
                    )
                  }
                />
                <span className="min-w-0 space-y-1 text-sm">
                  <span className="block font-medium">{route.name}</span>
                  <span className="block break-all font-mono text-xs text-primary">
                    {route.method} {route.path}
                  </span>
                  <span className="block text-xs text-muted-foreground">{route.description}</span>
                </span>
              </label>
            ))}
            {!permissions.length && (
              <p className="text-xs text-muted-foreground">
                Esta chave está sem acesso às rotas da API.
              </p>
            )}
          </fieldset>
          {needsBoxes && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Caixas autorizadas ({boxes.length})</legend>
              <p className="text-xs text-muted-foreground">
                O conteúdo será limitado a estas caixas e ao acesso do usuário consultado. Somente
                caixas que você administra podem ser autorizadas.
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {mailboxes.map((box) => (
                  <label
                    key={box.id}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={boxes.includes(box.id)}
                      onChange={(e) =>
                        setBoxes((current) =>
                          e.target.checked
                            ? [...current, box.id]
                            : current.filter((id) => id !== box.id),
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      {box.name}
                      <span className="block text-xs text-muted-foreground">
                        {box.email_address}
                      </span>
                    </span>
                  </label>
                ))}
                {!mailboxes.length && (
                  <p className="p-2 text-xs text-muted-foreground">
                    Nenhuma caixa administrada por você está disponível.
                  </p>
                )}
              </div>
            </fieldset>
          )}
          {needsUsers && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Usuários autorizados ({selected.length})
              </legend>
              <p className="text-xs text-muted-foreground">
                As rotas consultam somente os usuários selecionados, respeitando o acesso de cada um
                às caixas.
              </p>
              <Input
                aria-label="Pesquisar usuários autorizados"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar nome ou e-mail"
              />
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {visibleUsers.map((user) => (
                  <label
                    key={user.id}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(user.id)}
                      onChange={(event) =>
                        setSelected((current) =>
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
                {!visibleUsers.length && (
                  <p role="status" className="p-2 text-xs text-muted-foreground">
                    Nenhum usuário encontrado.
                  </p>
                )}
              </div>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={busy || (needsUsers && !selected.length) || (needsBoxes && !boxes.length)}
            >
              {busy ? 'Salvando…' : 'Salvar acessos'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
