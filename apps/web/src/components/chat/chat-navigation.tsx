import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { useChatConversations } from '@/hooks/use-chat';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
export function ChatNavigation({ onNavigate }: { onNavigate: () => void }) {
  const list = useChatConversations(),
    count = list.data?.reduce((total, conversation) => total + conversation.unread_count, 0) ?? 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/chat"
          activeProps={{ className: 'bg-accent text-accent-foreground' }}
          onClick={onNavigate}
          aria-label={
            count > 0
              ? `Chat, ${count} ${count === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`
              : 'Chat'
          }
          className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9"
        >
          <MessageSquare className="size-4 shrink-0" aria-hidden />
          {count > 0 && (
            <span
              className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
              aria-hidden="true"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Chat</TooltipContent>
    </Tooltip>
  );
}
