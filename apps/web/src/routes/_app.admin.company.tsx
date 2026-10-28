import { createFileRoute } from '@tanstack/react-router';
import { requireSettingsPermission } from '@/lib/settings';
import { CompanySettings } from '@/components/settings/company-settings';
export const Route = createFileRoute('/_app/admin/company')({
  beforeLoad: () => requireSettingsPermission('company.manage'),
  component: CompanySettings,
});
