import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ConversationPanel } from '@/components/chat/conversation-panel';
export const Route = createFileRoute('/_app/chat/$conversationId')({
  params: { parse: (params) => ({ conversationId: z.uuid().parse(params.conversationId) }) },
  component: Conversation,
});
function Conversation() {
  const { conversationId } = Route.useParams();
  return <ConversationPanel key={conversationId} id={conversationId} />;
}
