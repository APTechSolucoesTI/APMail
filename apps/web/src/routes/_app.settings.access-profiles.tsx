import { createFileRoute } from '@tanstack/react-router';
import { requireSettingsPermission } from '@/lib/settings';
import { AccessProfiles } from '@/components/settings/access-profiles';
export const Route = createFileRoute('/_app/settings/access-profiles')({
  beforeLoad: () => requireSettingsPermission('profiles.manage'),
  component: AccessProfiles,
});
