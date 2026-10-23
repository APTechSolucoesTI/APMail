import { createFileRoute } from '@tanstack/react-router';
import { requireSettingsPermission } from '@/lib/settings';
import { UserPermissions } from '@/components/settings/user-permissions';

export const Route = createFileRoute('/_app/settings/user-permissions')({
  beforeLoad: () => requireSettingsPermission('users.manage'),
  component: UserPermissions,
});
