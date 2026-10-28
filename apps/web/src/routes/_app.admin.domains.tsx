import { createFileRoute } from '@tanstack/react-router';
import { requireSettingsPermission } from '@/lib/settings';
import { DomainList } from '@/components/admin/domains';
export const Route = createFileRoute('/_app/admin/domains')({
  beforeLoad: () => requireSettingsPermission('domains.view'),
  component: DomainList,
});
