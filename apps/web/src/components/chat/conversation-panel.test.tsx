import { EventEmitter } from 'node:events';
import type { ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatConversation, ChatMessage } from '@apmail/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useChatRealtime } from '@/hooks/use-chat';
import { api } from '@/lib/api';
import { TenantContext } from '@/lib/auth';
import { ConversationPanel } from './conversation-panel';
import { ChatNavigation } from './chat-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, 'aria-label': label }: { children: ReactNode; 'aria-label'?: string }) => (
    <a href="/chat" aria-label={label}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }));
vi.mock('./chat-input', () => ({ ChatInput: () => null }));
vi.mock('./group-participants', () => ({ GroupParticipants: () => null }));
vi.mock('./message-bubble', () => ({
  MessageBubble: ({ message }: { message: ChatMessage }) => <p>{message.body}</p>,
}));
afterEach(() => vi.unstubAllGlobals());

it('keeps a realtime message unread in an open conversation until acknowledged', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const me = { id: 'me', full_name: 'Minha conta', avatar_url: null };
  const sender = { id: 'other', full_name: 'Ana', avatar_url: null };
  const conversation: ChatConversation = {
    id: 'chat',
    name: null,
    type: 'direct',
    participants: [me, sender],
    last_message: null,
    unread_count: 0,
  };
  const message: ChatMessage = {
    id: 'incoming',
    conversation_id: 'chat',
    sender_id: sender.id,
    sender,
    client_id: null,
    body: 'Mensagem recém-chegada',
    shared_thread_id: null,
    shared_snapshot: null,
    created_at: '2026-11-04T12:00:00Z',
    edited_at: null,
    deleted_at: null,
  };
  const socket = new EventEmitter();
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['me'], { user: me, current_tenant_id: 'tenant', preferences: {} });
  client.setQueryData(['chat-conversations', 'tenant', me.id], [conversation]);
  client.setQueryData(['chat-messages', 'tenant', conversation.id, me.id], {
    pages: [[]],
    pageParams: [undefined],
  });
  client.setQueryData(['chat-presence', 'tenant'], { online_user_ids: [] });
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/chat/conversations' ? [conversation] : { ok: true },
  );
  function Harness() {
    useChatRealtime(socket as unknown as Socket, 'tenant', me.id);
    return (
      <>
        <ChatNavigation onNavigate={() => undefined} />
        <ConversationPanel id={conversation.id} />
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <TenantContext.Provider value="tenant">
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </TenantContext.Provider>
    </QueryClientProvider>,
  );
  expect(screen.getByRole('link', { name: 'Chat' })).toBeVisible();
  act(() => {
    socket.emit('chat:message', { conversation_id: conversation.id, message });
  });
  expect(await screen.findByText(message.body)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Chat, 1 mensagem não lida' })).toBeVisible();
  expect(api).not.toHaveBeenCalledWith('/chat/conversations/chat/read', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Marcar como lidas' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/chat/conversations/chat/read', { method: 'POST' }),
  );
  expect(await screen.findByRole('link', { name: 'Chat' })).toBeVisible();
});
