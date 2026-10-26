import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MailboxConnectionNotice } from './mailbox-connection-notice';
import { MailboxStatusBadge } from '@/components/common/status-badge';
it('informa recuperação automática sem declarar conexão online', () => {
  const retry = vi.fn();
  render(
    <>
      <MailboxStatusBadge status="error" recovering />
      <MailboxConnectionNotice
        box={{ status: 'error', last_error: null, connection_error_kind: 'transient' }}
        admin
        busy={false}
        onReconnect={retry}
      />
    </>,
  );
  expect(screen.getByText('Reconectando')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('automaticamente');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar agora' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it('mantém falhas de senha visíveis e a tentativa manual restrita ao administrador', () => {
  render(
    <MailboxConnectionNotice
      box={{
        status: 'error',
        last_error: 'Senha inválida',
        connection_error_kind: 'authentication',
      }}
      admin={false}
      busy={false}
      onReconnect={() => {}}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Senha inválida');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('não mostra alerta em uma caixa conectada', () => {
  const { container } = render(
    <MailboxConnectionNotice
      box={{ status: 'active', last_error: null }}
      admin
      busy={false}
      onReconnect={() => {}}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});
