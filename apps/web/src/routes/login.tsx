import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '@/components/auth/login-form';

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { reason?: 'outside_schedule'; external?: true } => ({
    ...(search.reason === 'outside_schedule' ? { reason: 'outside_schedule' } : {}),
    ...(search.external === true ? { external: true } : {}),
  }),
  component: LoginPage,
});

function LoginPage() {
  return <LoginForm external={Route.useSearch().external} />;
}
