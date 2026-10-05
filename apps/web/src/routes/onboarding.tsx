import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { tenantSchema } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { requireUser } from '@/lib/auth';
export const Route = createFileRoute('/onboarding')({
  beforeLoad: async () => {
    const me = await requireUser();
    if (me.platform_admin) throw redirect({ to: '/superadmin' });
    return me;
  },
  component: Onboarding,
});
function Onboarding() {
  const navigate = useNavigate();
  return (
    <AuthShell title="Sua empresa" description="Crie o espaço compartilhado da sua equipe.">
      <SchemaForm
        schema={tenantSchema}
        fields={[
          { name: 'name', label: 'Nome da empresa' },
          {
            name: 'slug',
            label: 'Identificador',
            help: 'De 3 a 60 caracteres: letras minúsculas, números e hífen.',
          },
        ]}
        submitLabel="Criar empresa"
        onSubmit={async (b) => {
          await api('/tenants', { method: 'POST', body: b });
          await queryClient.invalidateQueries();
          await navigate({ to: '/' });
        }}
      />
    </AuthShell>
  );
}
