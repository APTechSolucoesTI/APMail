import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { loginSchema, type PasswordLoginResult } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { TwoFactorForm } from '@/components/auth/two-factor-form';
import { Button } from '@/components/ui/button';
export function LoginForm() {
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<string | null>(null);
  async function signedIn() {
    queryClient.clear();
    await navigate({ to: '/' });
  }
  return (
    <AuthShell
      title={challenge ? 'Verificação em duas etapas' : 'Entrar'}
      description={
        challenge
          ? 'Confirme que é você para acessar sua conta.'
          : 'Acesse as caixas de e-mail da sua equipe.'
      }
    >
      {new URLSearchParams(window.location.search).get('reason') === 'outside_schedule' && (
        <p role="alert" className="mb-4 rounded-md border bg-muted p-3 text-sm">
          Seu horário de acesso terminou. Entre novamente no próximo expediente ou solicite uma
          exceção ao administrador.
        </p>
      )}
      {challenge ? (
        <div className="space-y-4">
          <TwoFactorForm
            submitLabel="Entrar"
            onSubmit={async (b) => {
              await api('/auth/two-factor/login', {
                method: 'POST',
                body: { challenge, code: b.code },
              });
              await signedIn();
            }}
          />
          <Button variant="outline" onClick={() => setChallenge(null)}>
            Voltar para e-mail e senha
          </Button>
        </div>
      ) : (
        <SchemaForm
          schema={loginSchema}
          submitLabel="Entrar"
          fields={[
            { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'username' },
            {
              name: 'password',
              label: 'Senha',
              type: 'password',
              autoComplete: 'current-password',
            },
          ]}
          onSubmit={async (b) => {
            const result = await api<PasswordLoginResult>('/auth/login', {
              method: 'POST',
              body: b,
            });
            if (result.requires_two_factor) setChallenge(result.challenge);
            else await signedIn();
          }}
        />
      )}
      {!challenge && (
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link to="/forgot-password" className="text-primary underline">
            Esqueci minha senha
          </Link>
          <Link to="/signup" className="text-primary underline">
            Criar conta
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
