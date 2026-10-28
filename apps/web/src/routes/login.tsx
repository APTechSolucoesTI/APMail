import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '@/components/auth/login-form';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { reason?: 'outside_schedule' } =>
    search.reason === 'outside_schedule' ? { reason: 'outside_schedule' } : {},
  component: LoginForm,
});
