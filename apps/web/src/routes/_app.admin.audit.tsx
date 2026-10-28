import { createFileRoute } from '@tanstack/react-router';
import { requireSettingsCapability } from '@/lib/settings';
import { AuditExplorer, auditSearchSchema } from '@/components/settings/audit-explorer';
export const Route = createFileRoute('/_app/admin/audit')({
  beforeLoad: () => requireSettingsCapability('audit'),
  validateSearch: auditSearchSchema,
  component: AuditPage,
});
function AuditPage() {
  return <AuditExplorer query={Route.useSearch()} />;
}
