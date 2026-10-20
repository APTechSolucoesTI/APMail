import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { passwordSchema } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { toast } from 'sonner';
export const Route = createFileRoute('/reset-password')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: Reset,
});
function Reset() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AuthShell title="Redefinir senha" description="Escolha uma nova senha para sua conta.">
      {!token ? (
        <p role="alert">Link inválido. Solicite outro link de recuperação.</p>
      ) : (
        <SchemaForm
          schema={z.object({ password: passwordSchema })}
          fields={[
            {
              name: 'password',
              label: 'Nova senha',
              type: 'password',
              autoComplete: 'new-password',
            },
          ]}
          submitLabel="Redefinir senha"
          onSubmit={async (b) => {
            const result = await api<{ requires_two_factor?: boolean }>('/auth/reset-password', {
              method: 'POST',
              body: { ...b, token },
            });
            queryClient.clear();
            if (result.requires_two_factor) {
              toast.success('Senha atualizada. Entre e confirme o código do autenticador.');
              await navigate({ to: '/login' });
            } else await navigate({ to: '/' });
          }}
        />
      )}
    </AuthShell>
  );
}
