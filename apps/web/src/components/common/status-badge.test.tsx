import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { QueueStatusBadge, MailboxStatusBadge } from './status-badge';
it('comunica estado com texto e omite a fila none', () => {
  const { container } = render(
    <>
      <QueueStatusBadge status="to_reply" />
      <MailboxStatusBadge status="error" />
      <QueueStatusBadge status="none" />
    </>,
  );
  expect(screen.getByText('A responder')).toBeInTheDocument();
  expect(screen.getByText('Erro de conexão')).toBeInTheDocument();
  expect(container.querySelectorAll('svg')).toHaveLength(2);
  expect(screen.queryByText('Sem fila')).not.toBeInTheDocument();
});
