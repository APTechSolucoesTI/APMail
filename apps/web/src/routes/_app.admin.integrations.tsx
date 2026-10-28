import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { GoogleIntegration } from '@/components/integrations/google-integration';
export const Route = createFileRoute('/_app/admin/integrations')({
  validateSearch: z.object({ google: z.enum(['connected', 'cancelled', 'failed']).optional() }),
  component: Integrations,
});
function Integrations() {
  const search = Route.useSearch();
  return <GoogleIntegration result={search.google} />;
}
