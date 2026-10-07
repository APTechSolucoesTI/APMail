import { createFileRoute } from '@tanstack/react-router';
import { listQuerySchema } from '@apmail/shared';
import { LabelsSettings } from '@/components/mail/labels-settings';
export const Route = createFileRoute('/_app/settings/labels')({
  validateSearch: listQuerySchema,
  component: Labels,
});
function Labels() {
  const query = Route.useSearch(),
    navigate = Route.useNavigate();
  return <LabelsSettings query={query} onQueryChange={(search) => void navigate({ search })} />;
}
