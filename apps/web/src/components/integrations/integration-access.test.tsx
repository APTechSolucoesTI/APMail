import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { WebhookForm } from './webhook-form';
import { ApiTokenAccess } from './api-token-access';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

it('seleciona os dois eventos do webhook e impede salvar sem evento', async () => {
  vi.mocked(api).mockResolvedValue({ success: true });
  const onSaved = vi.fn(async () => {});
  render(
    <WebhookForm
      value={{
        id: 'webhook',
        name: 'Sistema',
        url: 'https://example.com/events',
        enabled: true,
        event: 'email.received',
        events: ['email.received'],
        mailbox_ids: ['box'],
      }}
      mailboxes={[{ id: 'box', name: 'Financeiro', email_address: 'financeiro@example.com' }]}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /E-mail recebido/ }));
  expect(screen.getByRole('button', { name: 'Salvar webhook' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /E-mail enviado/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /E-mail recebido/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar webhook' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith('/integrations/webhooks/webhook', {
    method: 'PUT',
    body: {
      name: 'Sistema',
      url: 'https://example.com/events',
      enabled: true,
      events: ['email.sent', 'email.received'],
      mailbox_ids: ['box'],
    },
  });
});

it('agrupa as rotas de mensagens e conversa sob a mesma permissão', () => {
  render(
    <ApiTokenAccess
      token={{
        id: 'token',
        name: 'Sistema',
        permissions: ['messages:read'],
        user_ids: ['user'],
        mailbox_ids: ['box'],
      }}
      routes={['/api/integrations/messages', '/api/integrations/threads/:threadId'].map((path) => ({
        permission: 'messages:read',
        name: 'Consultar mensagens',
        description: 'Consulta autorizada',
        method: 'GET',
        path,
      }))}
      users={[{ id: 'user', full_name: 'Pessoa', email: 'pessoa@example.com' }]}
      mailboxes={[{ id: 'box', name: 'Financeiro', email_address: 'financeiro@example.com' }]}
      onClose={vi.fn()}
      onSaved={async () => {}}
    />,
  );
  expect(screen.getByText('GET /api/integrations/messages')).toBeVisible();
  expect(screen.getByText('GET /api/integrations/threads/:threadId')).toBeVisible();
  expect(screen.getAllByRole('checkbox', { name: /Consultar mensagens/ })).toHaveLength(1);
});
