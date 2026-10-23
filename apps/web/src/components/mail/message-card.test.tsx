import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MessageCard } from './message-card';
import type { Message } from '@/lib/mail';
vi.mock('@/lib/auth', () => ({ useAccess: () => true }));

vi.mock('./email-body-frame', () => ({ EmailBodyFrame: () => <div>Conteúdo recebido</div> }));
vi.mock('./message-actions', () => ({
  MessageActions: ({ inTrash }: { inTrash?: boolean }) => (
    <button>{inTrash ? 'Restaurar' : 'Mover'}</button>
  ),
}));
vi.mock('./read-receipt', () => ({ ReadReceipt: () => null }));
vi.mock('./calendar-invite', () => ({ CalendarInvitation: () => null }));
vi.mock('@/components/contacts/contact-form', () => ({
  ContactEditorDialog: ({ id }: { id: string }) => <div role="dialog">Contato {id}</div>,
}));
vi.mock('@/components/contacts/contact-association-dialog', () => ({
  ContactAssociationDialog: () => <div role="dialog">Adicionar contato</div>,
}));
const message: Message = {
  id: 'message',
  direction: 'inbound',
  folder_id: 'inbox',
  subject: 'Proposta',
  from_address: 'ana@example.com',
  from_name: 'Ana',
  to_addresses: [{ address: 'equipe@example.com', name: 'Equipe' }],
  cc_addresses: [],
  reply_to_addresses: [],
  message_at: '2026-10-22T12:00:00Z',
  snippet: 'Resumo da proposta',
  body_html: null,
  body_text: 'Proposta recebida',
  is_flagged: false,
  pending_action: false,
  attachments: [],
  sent_by: null,
};
it('oferece controles explícitos e acessíveis para recolher e expandir o corpo', () => {
  render(
    <MessageCard
      message={message}
      expanded
      cidMap={{}}
      loadRemoteImages={false}
      organize
      mailboxId="box"
      folders={[]}
    />,
  );
  const collapse = screen.getByRole('button', { name: 'Recolher mensagem de Ana' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(collapse);
  expect(screen.queryByText('Conteúdo recebido')).not.toBeInTheDocument();
  expect(screen.getByText(message.snippet)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Expandir mensagem de Ana' }));
  expect(screen.getByText('Conteúdo recebido')).toBeVisible();
});
it('mantém todas as ações acima do corpo e encaminha a mensagem escolhida', () => {
  const compose = vi.fn();
  render(
    <MessageCard
      message={message}
      expanded
      cidMap={{}}
      loadRemoteImages={false}
      organize
      mailboxId="box"
      folders={[]}
      onCompose={compose}
    />,
  );
  const toolbar = screen.getByRole('group', { name: 'Ações da mensagem' });
  const body = screen.getByText('Conteúdo recebido');
  expect(toolbar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const [name, mode] of [
    ['Responder', 'reply'],
    ['Responder a todos', 'reply_all'],
    ['Encaminhar', 'forward'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(compose).toHaveBeenLastCalledWith(mode + ':message');
  }
  expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Mover' }));
});
it('abre contato pelo nome cadastrado, sem ação separada Ver contato', () => {
  render(
    <MessageCard
      message={message}
      expanded
      cidMap={{}}
      loadRemoteImages={false}
      organize={false}
      mailboxId="box"
      folders={[]}
      contacts={{ 'ana@example.com': { id: 'ana', name: 'Ana cadastrada', scope: 'tenant' } }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ana cadastrada' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Contato ana');
  expect(screen.queryByText('Ver contato')).not.toBeInTheDocument();
});
it('preserva adição de remetentes desconhecidos junto à identidade', () => {
  render(
    <MessageCard
      message={message}
      expanded
      cidMap={{}}
      loadRemoteImages={false}
      organize={false}
      mailboxId="box"
      folders={[]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar aos contatos' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Adicionar contato');
});
it('identifica a Lixeira pela pasta da mensagem, independentemente da conversa', () => {
  render(
    <MessageCard
      message={{ ...message, folder_id: 'trash' }}
      expanded
      cidMap={{}}
      loadRemoteImages={false}
      organize
      mailboxId="box"
      folders={[
        {
          id: 'trash',
          name: 'Deleted Items',
          parent_id: null,
          special_use: 'trash',
          unread_count: 0,
          children: [],
        },
      ]}
    />,
  );
  expect(screen.getByRole('button', { name: 'Restaurar' })).toBeVisible();
});
