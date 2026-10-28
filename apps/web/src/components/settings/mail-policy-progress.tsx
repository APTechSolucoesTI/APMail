import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
export function MailPolicyProgress() {
  const tenant = useTenantId(),
    q = useQuery({
      queryKey: ['mail-policy-refresh', tenant],
      queryFn: () =>
        api<{ state: string; processed: number; error?: string | null }>(
          '/tenant/mail-policy-refresh',
        ),
      refetchInterval: 5000,
    });
  if (!q.data || ['succeeded', 'superseded'].includes(q.data.state)) return null;
  return (
    <p role="status" className="rounded-md border bg-muted p-3 text-sm">
      {q.data.state === 'failed'
        ? 'A atualização das filas será tentada novamente.'
        : 'Atualizando as filas com as mensagens atuais…'}{' '}
      {q.data.processed} conversas processadas. Você pode continuar usando o e-mail.
    </p>
  );
}
