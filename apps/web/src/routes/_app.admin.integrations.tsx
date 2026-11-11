import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { GoogleIntegration } from '@/components/integrations/google-integration';
import { ApiTokens } from '@/components/integrations/api-tokens';
import { Webhooks } from '@/components/integrations/webhooks';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { isTenantAdmin } from '@apmail/shared';
import { meQuery, useAccess } from '@/lib/auth';
export const Route = createFileRoute('/_app/admin/integrations')({
  validateSearch: z.object({ google: z.enum(['connected', 'cancelled', 'failed']).optional() }),
  component: Integrations,
});
function Integrations() {
  const search = Route.useSearch();
  const me = useQuery(meQuery).data;
  const member = me?.tenants.find((t) => t.id === me.current_tenant_id);
  const allowed = useAccess('integrations');
  const manage =
    member &&
    (member.access_profile_id || member.has_custom_permissions
      ? allowed
      : isTenantAdmin(member.role));
  if (!manage) return <GoogleIntegration result={search.google} />;
  return (
    <Tabs defaultValue="google">
      <TabsList aria-label="Integrações">
        <TabsTrigger value="google">Google</TabsTrigger>
        <TabsTrigger value="tokens">Tokens de API</TabsTrigger>
        <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
      </TabsList>
      <TabsContent value="google">
        <GoogleIntegration result={search.google} />
      </TabsContent>
      <TabsContent value="tokens">
        <ApiTokens />
      </TabsContent>
      <TabsContent value="webhooks">
        <Webhooks />
      </TabsContent>
    </Tabs>
  );
}
