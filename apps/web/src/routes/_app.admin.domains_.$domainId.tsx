import { createFileRoute } from '@tanstack/react-router';
import { requireSettingsPermission } from '@/lib/settings';
import { DomainDetail } from '@/components/admin/domains';
export const Route = createFileRoute('/_app/admin/domains_/$domainId')({
  beforeLoad: () => requireSettingsPermission('domains.view'),
  component: Page,
});
function Page() {
  return <DomainDetail domainId={Route.useParams().domainId} />;
}
