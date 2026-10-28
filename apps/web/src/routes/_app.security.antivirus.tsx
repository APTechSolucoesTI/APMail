import { createFileRoute } from '@tanstack/react-router';
import { listQuerySchema } from '@apmail/shared';
import { requireSettingsPermission } from '@/lib/settings';
import { AntivirusPanel } from '@/components/security/antivirus-panel';
export const Route = createFileRoute('/_app/security/antivirus')({
  beforeLoad: () => requireSettingsPermission('antivirus.view'),
  validateSearch: listQuerySchema,
  component: AntivirusPage,
});
function AntivirusPage() {
  return <AntivirusPanel query={Route.useSearch()} />;
}
