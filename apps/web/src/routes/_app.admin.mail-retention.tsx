import { createFileRoute } from '@tanstack/react-router';
import { requireAdmin, requireSettingsPermission } from '@/lib/settings';
import { MailRetentionPanel } from '@/components/admin/mail-retention-panel';

export const Route = createFileRoute('/_app/admin/mail-retention')({
  beforeLoad: async () => {
    await requireAdmin();
    await requireSettingsPermission('retention.manage');
  },
  component: MailRetentionPanel,
});
