import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { fullNameSchema, passwordSchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { SchemaForm } from '@/components/forms/schema-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/common/user-avatar';
import { meQuery } from '@/lib/auth';
import { api } from '@/lib/api';
import { toast } from 'sonner';
export const Route = createFileRoute('/_app/settings/profile')({ component: Profile });
function Profile() {
  const q = useQuery(meQuery);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const user = q.data.user;
  return (
    <>
      <PageHeader title="Meu perfil" description="Atualize seus dados e proteja sua conta." />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-xl font-semibold">Dados pessoais</h2>
          <div className="flex items-center gap-3">
            <UserAvatar name={user.full_name} src={user.avatar_url} size={40} />
            <span className="break-all text-sm text-muted-foreground">{user.email}</span>
          </div>
          <SchemaForm
            cancelLabel="Cancelar"
            schema={z.object({ full_name: fullNameSchema })}
            defaults={{ full_name: user.full_name }}
            fields={[{ name: 'full_name', label: 'Nome completo', autoComplete: 'name' }]}
            onSubmit={async (b) => {
              await api('/me', { method: 'PATCH', body: b });
              await client.invalidateQueries({ queryKey: ['me'] });
              toast.success('Perfil atualizado.');
            }}
          />
          <Label htmlFor="avatar">Foto do perfil (JPEG, PNG ou WebP, até 2 MB)</Label>
          <Input
            id="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                toast.error('Escolha uma imagem de até 2 MB.');
                return;
              }
              setBusy(true);
              try {
                const body = new FormData();
                body.set('file', file);
                const response = await fetch('/api/me/avatar', {
                  method: 'POST',
                  credentials: 'same-origin',
                  body,
                });
                if (!response.ok) throw new Error('Não foi possível salvar a imagem.');
                await client.invalidateQueries({ queryKey: ['me'] });
                toast.success('Foto atualizada.');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Falha ao enviar a foto.');
              } finally {
                setBusy(false);
              }
            }}
          />
          {user.avatar_url && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/me/avatar', { method: 'DELETE' });
                  await client.invalidateQueries({ queryKey: ['me'] });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remover foto
            </Button>
          )}
        </section>
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-xl font-semibold">Alterar senha</h2>
          <p className="text-sm text-muted-foreground">
            Você será desconectado dos outros dispositivos.
          </p>
          <SchemaForm
            cancelLabel="Cancelar"
            schema={z
              .object({
                current_password: z.string().min(1),
                new_password: passwordSchema,
                confirmation: z.string(),
              })
              .refine((b) => b.new_password === b.confirmation, {
                path: ['confirmation'],
                message: 'As senhas precisam ser iguais.',
              })}
            fields={[
              {
                name: 'current_password',
                label: 'Senha atual',
                type: 'password',
                autoComplete: 'current-password',
              },
              {
                name: 'new_password',
                label: 'Nova senha',
                type: 'password',
                autoComplete: 'new-password',
              },
              {
                name: 'confirmation',
                label: 'Confirme a nova senha',
                type: 'password',
                autoComplete: 'new-password',
              },
            ]}
            submitLabel="Alterar senha"
            onSubmit={async (b) => {
              await api('/auth/change-password', {
                method: 'POST',
                body: { current_password: b.current_password, new_password: b.new_password },
              });
              toast.success('Senha alterada.');
            }}
          />
        </section>
      </div>
    </>
  );
}
