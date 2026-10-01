import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { loginSchema } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
export const Route = createFileRoute('/login')({ component: Login });
function Login() {
  const navigate = useNavigate();
  return (
    <AuthShell title="Entrar" description="Acesse as caixas de e-mail da sua equipe.">
      <SchemaForm
        schema={loginSchema}
        submitLabel="Entrar"
        fields={[
          { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'username' },
          { name: 'password', label: 'Senha', type: 'password', autoComplete: 'current-password' },
        ]}
        onSubmit={async (b) => {
          await api('/auth/login', { method: 'POST', body: b });
          queryClient.clear();
          await navigate({ to: '/' });
        }}
      />
      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link to="/forgot-password" className="text-primary underline">
          Esqueci minha senha
        </Link>
        <Link to="/signup" className="text-primary underline">
          Criar conta
        </Link>
      </div>
    </AuthShell>
  );
}
