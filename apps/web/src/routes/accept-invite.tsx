import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { fullNameSchema, passwordSchema } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export const Route = createFileRoute('/accept-invite')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: Accept,
});
function Accept() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['invite', token],
    queryFn: () =>
      api<{
        tenant_name: string;
        email: string;
        inviter_name: string;
        user_exists: boolean;
        expired: boolean;
      }>('/invitations/by-token/' + token),
    enabled: !!token,
    retry: false,
  });
  const invitation = query.data;
  return (
    <AuthShell
      title="Convite para a equipe"
      description={
        invitation
          ? `${invitation.inviter_name} convidou você para ${invitation.tenant_name}.`
          : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : !invitation || invitation.expired ? (
        <p role="alert" className="text-sm">
          Convite inválido ou expirado. Solicite um novo convite.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm">
            Conta: <span className="font-semibold">{invitation.email}</span>
          </p>
          {invitation.user_exists && (
            <p className="mb-4 text-sm">
              Entre com essa conta e retorne a este convite.{' '}
              <Link to="/login" className="text-primary underline">
                Entrar
              </Link>
            </p>
          )}
          <SchemaForm
            schema={
              invitation.user_exists
                ? z.object({})
                : z.object({ full_name: fullNameSchema, password: passwordSchema })
            }
            fields={
              invitation.user_exists
                ? []
                : [
                    { name: 'full_name', label: 'Nome completo' },
                    {
                      name: 'password',
                      label: 'Senha',
                      type: 'password',
                      autoComplete: 'new-password',
                    },
                  ]
            }
            submitLabel="Aceitar convite"
            onSubmit={async (b) => {
              await api('/invitations/by-token/' + token + '/accept', { method: 'POST', body: b });
              queryClient.clear();
              await navigate({ to: '/' });
            }}
          />
        </>
      )}
    </AuthShell>
  );
}
