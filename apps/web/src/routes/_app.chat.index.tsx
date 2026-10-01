import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/data/data-state';
export const Route = createFileRoute('/_app/chat/')({
  component: () => (
    <EmptyState
      title="Escolha uma conversa"
      description="Abra uma pessoa ou grupo da lista para conversar."
    />
  ),
});
