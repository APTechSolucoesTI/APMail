import type { ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TenantContext } from '@/lib/auth';
import { SocketContext, useSocketRoom } from './use-socket-room';

function transport() {
  const connected = new Set<() => void>();
  const emit = vi.fn();
  const socket = {
    emit,
    on: (event: string, callback: () => void) => {
      if (event === 'connect') connected.add(callback);
    },
    off: (event: string, callback: () => void) => {
      if (event === 'connect') connected.delete(callback);
    },
  } as unknown as Socket;
  return { socket, emit, reconnect: () => [...connected].forEach((callback) => callback()) };
}
function Room({ id, type = 'mailbox' }: { id?: string; type?: 'mailbox' | 'thread' | 'chat' }) {
  useSocketRoom(type, id);
  return null;
}
function mount(socket: Socket, children: ReactNode) {
  const client = new QueryClient();
  return render(children, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <TenantContext.Provider value="tenant">
          <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
        </TenantContext.Provider>
      </QueryClientProvider>
    ),
  });
}
it('mantém a sala ativa enquanto a rota ou outra navegação ainda precisar dela', () => {
  const { socket, emit } = transport();
  const view = mount(
    socket,
    <>
      <Room key="route" id="inbox" />
      <Room key="sidebar" id="inbox" />
    </>,
  );
  expect(emit.mock.calls.filter(([event]) => event === 'mailbox:join')).toHaveLength(1);
  view.rerender(
    <>
      <Room key="route" id="inbox" />
    </>,
  );
  expect(emit.mock.calls.filter(([event]) => event === 'mailbox:leave')).toHaveLength(0);
  view.unmount();
  expect(emit.mock.calls.filter(([event]) => event === 'mailbox:leave')).toEqual([
    ['mailbox:leave', { mailbox_id: 'inbox' }],
  ]);
});
it('reingressa uma única vez por sala compartilhada após reconectar e remove o listener ao fechar', () => {
  const { socket, emit, reconnect } = transport();
  const view = mount(
    socket,
    <>
      <Room id="inbox" />
      <Room id="inbox" />
    </>,
  );
  emit.mockClear();
  reconnect();
  expect(emit.mock.calls.filter(([event]) => event === 'mailbox:join')).toHaveLength(1);
  view.unmount();
  emit.mockClear();
  reconnect();
  expect(emit).not.toHaveBeenCalled();
});
it('expansão de outra caixa e salas de conversa mantêm ciclos independentes', () => {
  const { socket, emit } = transport();
  const view = mount(
    socket,
    <>
      <Room id="a" />
      <Room id="b" />
      <Room id="a" type="thread" />
      <Room />
    </>,
  );
  expect(emit.mock.calls.map(([event, payload]) => [event, payload])).toEqual([
    ['mailbox:join', { mailbox_id: 'a' }],
    ['mailbox:join', { mailbox_id: 'b' }],
    ['thread:join', { thread_id: 'a' }],
  ]);
  view.unmount();
  expect(emit.mock.calls.filter(([event]) => event.endsWith(':leave'))).toHaveLength(3);
});
