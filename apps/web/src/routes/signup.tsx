import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { signupSchema } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
export const Route = createFileRoute('/signup')({ component: Signup });
function Signup() {
  const navigate = useNavigate();
  return (
    <AuthShell title="Criar conta" description="Comece a organizar o atendimento por e-mail.">
      <SchemaForm
        schema={signupSchema}
        submitLabel="Criar conta"
        fields={[
          { name: 'full_name', label: 'Nome completo', autoComplete: 'name' },
          { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            label: 'Senha',
            type: 'password',
            autoComplete: 'new-password',
            help: 'Ao menos 8 caracteres, com uma letra e um número.',
          },
        ]}
        onSubmit={async (b) => {
          await api('/auth/signup', { method: 'POST', body: b });
          queryClient.clear();
          await navigate({ to: '/onboarding' });
        }}
      />
      <Link to="/login" className="mt-6 block text-sm text-primary underline">
        Já tenho conta
      </Link>
    </AuthShell>
  );
}
