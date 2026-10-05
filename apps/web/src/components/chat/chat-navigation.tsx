import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { useChatConversations } from '@/hooks/use-chat';
export function ChatNavigation({ onNavigate }: { onNavigate: () => void }) {
  const list = useChatConversations(),
    count = list.data?.reduce((total, conversation) => total + conversation.unread_count, 0) ?? 0;
  return (
    <Link
      to="/chat"
      onClick={onNavigate}
      className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
    >
      <MessageSquare className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">Chat</span>
      {count > 0 && (
        <span
          className="shrink-0 rounded-sm bg-primary px-2 text-xs font-semibold text-primary-foreground"
          aria-label={`${count} mensagens não lidas no chat`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
