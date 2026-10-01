import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { emailSchema } from '@apmail/shared';
import { SchemaForm } from '@/components/forms/schema-form';
import { AuthShell } from '@/components/layout/auth-shell';
import { api } from '@/lib/api';
export const Route = createFileRoute('/forgot-password')({ component: Forgot });
function Forgot() {
  const [sent, setSent] = useState(false);
  return (
    <AuthShell title="Recuperar acesso" description="Enviaremos um link para redefinir sua senha.">
      {sent ? (
        <p role="status" className="text-sm">
          Se a conta existir, você receberá instruções por e-mail.
        </p>
      ) : (
        <SchemaForm
          schema={z.object({ email: emailSchema })}
          fields={[{ name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' }]}
          submitLabel="Enviar link"
          onSubmit={async (b) => {
            await api('/auth/forgot-password', { method: 'POST', body: b });
            setSent(true);
          }}
        />
      )}
      <Link to="/login" className="mt-6 block text-sm text-primary underline">
        Voltar para entrar
      </Link>
    </AuthShell>
  );
}
