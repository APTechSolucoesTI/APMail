import { createFileRoute } from '@tanstack/react-router';
import { listQuerySchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { RuleManagement } from '@/components/settings/rule-management';
export const Route = createFileRoute('/_app/settings/rules')({
  validateSearch: listQuerySchema,
  component: Rules,
});
function Rules() {
  const query = Route.useSearch(),
    navigate = Route.useNavigate();
  return (
    <>
      <PageHeader
        title="Regras"
        description="Automatize a organização das caixas e das suas conversas."
      />
      <RuleManagement query={query} onQueryChange={(search) => void navigate({ search })} />
    </>
  );
}
