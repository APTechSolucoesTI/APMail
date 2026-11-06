import { it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { Composer } from './composer';
import { meQuery } from '@/lib/auth';
import { pendingSecurity, type AttachmentSecurity } from '@/lib/antivirus';
import { DEFAULT_COMPOSITION_FORMAT } from '@apmail/shared';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/components/forms/rich-text-editor', () => ({ RichTextEditor: () => <div>Editor</div> }));
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }));
const id = '123e4567-e89b-42d3-a456-426614174000';
beforeEach(() => {
  vi.mocked(api).mockReset();
});
function open(
  preference: boolean,
  mode = 'new',
  attachment = false,
  security: AttachmentSecurity = pendingSecurity,
  cachedSecurity?: AttachmentSecurity,
  gallery = false,
  delegated = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(meQuery.queryKey, {
    user: { id: 'user' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'owner', access_permissions: null }],
    preferences: { request_read_receipt: preference, timezone: 'America/Sao_Paulo' },
  });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/preferences/composition')
      return { default_format: DEFAULT_COMPOSITION_FORMAT, overrides: [] };
    if (path === '/mailboxes')
      return delegated
        ? []
        : [{ id, email_address: 'box@example.com', aliases: [], role: 'editor', status: 'active' }];
    if (path === '/signatures') return [];
    if (path.startsWith('/outbox/'))
      return {
        id,
        mailbox_id: id,
        status: 'draft',
        request_read_receipt: false,
        body_html: '',
        updated_at: new Date().toISOString(),
      };
    if (path.endsWith('/security')) return gallery ? pendingSecurity : security;
    if (path.startsWith('/threads/'))
      return {
        delegated,
        my_role: 'editor',
        mailbox: {
          id,
          name: 'Caixa convidada',
          email_address: 'box@example.com',
          aliases: [],
          role: 'editor',
          status: 'active',
        },
        thread: { id },
        messages: [
          {
            id,
            subject: 'Original',
            from_address: 'sender@example.com',
            from_name: 'Sender',
            to_addresses: [],
            cc_addresses: [],
            reply_to_addresses: [],
            attachments: attachment
              ? [
                  ...(gallery
                    ? [
                        {
                          id,
                          filename: 'imagem.png',
                          content_type: 'image/png',
                          size_bytes: 50,
                          is_inline: false,
                          security,
                        },
                      ]
                    : []),
                  {
                    id: gallery ? '123e4567-e89b-42d3-a456-426614174001' : id,
                    filename: 'pendente.pdf',
                    size_bytes: 50,
                    is_inline: false,
                    security: gallery ? pendingSecurity : security,
                  },
                ]
              : [],
            message_at: new Date().toISOString(),
            body_html: '<p>Original</p>',
            body_text: 'Original',
          },
        ],
      };
    return { settings: {} };
  });
  if (cachedSecurity)
    client.setQueryData(['attachment-security', null, 'attachment', id], cachedSecurity);
  render(
    <QueryClientProvider client={client}>
      <Composer
        mailboxId={id}
        threadId={mode === 'new' ? undefined : id}
        mode={mode}
        onClose={() => {}}
        onReopen={() => {}}
      />
    </QueryClientProvider>,
  );
  return client;
}
it('preferência ativa marca o checkbox; mudança manual não altera preferências', async () => {
  const client = open(true);
  const checkbox = await screen.findByRole('checkbox', {
    name: 'Solicitar confirmação de leitura',
  });
  expect(checkbox).toBeChecked();
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox).not.toBeChecked());
  expect(
    client.getQueryData<{ preferences: { request_read_receipt: boolean } }>(meQuery.queryKey)
      ?.preferences.request_read_receipt,
  ).toBe(true);
});
it('preferência desativada inicia sem solicitação e aceita ativação individual', async () => {
  open(false);
  const checkbox = await screen.findByRole('checkbox', {
    name: 'Solicitar confirmação de leitura',
  });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();
});
it.each(['reply', 'reply_all', 'forward'])('aplica preferência em %s', async (mode) => {
  open(true, mode + ':' + id);
  expect(
    await screen.findByRole('checkbox', { name: 'Solicitar confirmação de leitura' }),
  ).toBeChecked();
});
it('reabrir rascunho preserva escolha manual mesmo com preferência ativa', async () => {
  open(true, 'draft:' + id);
  expect(
    await screen.findByRole('checkbox', { name: 'Solicitar confirmação de leitura' }),
  ).not.toBeChecked();
});

it('prevents forwarding an unverified attachment while preserving draft editing', async () => {
  open(false, 'forward:' + id, true);
  expect(await screen.findByText('Verificação pendente')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
});

it('focuses the missing subject and keeps the draft editable without submitting', async () => {
  open(false);
  const subject = await screen.findByRole('textbox', { name: 'Assunto' });
  fireEvent.change(subject, { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Informe o assunto');
  await waitFor(() => expect(subject).toHaveFocus());
  expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Opções de envio' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Agendar envio…' }));
  expect(screen.queryByRole('dialog', { name: 'Agendar envio' })).not.toBeInTheDocument();
  await waitFor(() => expect(subject).toHaveFocus());
});

it('navigates from a verified forwarded image to a blocked attachment without exposing bytes', async () => {
  open(false, 'forward:' + id, true, { ...pendingSecurity, status: 'clean' }, undefined, true);
  fireEvent.click(await screen.findByRole('button', { name: 'Visualizar imagem.png' }));
  expect(screen.getByRole('img', { name: 'imagem.png' })).toHaveAttribute(
    'src',
    '/api/attachments/' + id + '/inline',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Próximo anexo' }));
  expect(screen.getByText('2 de 2')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Baixar anexo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Anexo anterior' }));
  expect(screen.getByRole('link', { name: 'Baixar anexo' })).toHaveAttribute(
    'href',
    '/api/attachments/' + id + '/download',
  );
});

it('uses current server security when reopening a file with an older cached verdict', async () => {
  open(
    false,
    'forward:' + id,
    true,
    { ...pendingSecurity, status: 'clean' },
    { ...pendingSecurity, status: 'infected' },
  );
  await screen.findByText('pendente.pdf (1 KB)');
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
});

it('resposta de convidado usa a caixa da conversa sem acesso à listagem da caixa', async () => {
  open(false, 'reply:' + id, false, pendingSecurity, undefined, false, true);
  expect(await screen.findByLabelText('Assunto')).toHaveValue('Re: Original');
  expect(screen.getByRole('button', { name: 'Remover sender@example.com' })).toBeVisible();
  expect(screen.getByRole('option', { name: /Caixa convidada/ })).toBeInTheDocument();
  expect(screen.queryByText('A mensagem original não está disponível.')).not.toBeInTheDocument();
});
