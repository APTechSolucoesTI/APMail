import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_COMPOSITION_FORMAT, outboxSchema, type OutboxInput } from '@apmail/shared';
import { Composer } from './composer';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { pendingSecurity } from '@/lib/antivirus';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }));
vi.mock('@/components/forms/rich-text-editor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Mensagem" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const id = '123e4567-e89b-42d3-a456-426614174000';
const attachmentId = '123e4567-e89b-42d3-a456-426614174001';
const clean = { ...pendingSecurity, status: 'clean' as const };
beforeEach(() => {
  vi.mocked(api).mockReset();
});

it('salva endereço incompleto sem erro técnico, restaura a digitação e impede envio', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(meQuery.queryKey, {
    user: { id: 'user' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'owner', access_permissions: null }],
    preferences: { timezone: 'America/Sao_Paulo' },
  });
  let saved: OutboxInput | undefined;
  let submitted = false;
  const close = vi.fn();
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/preferences/composition')
      return { default_format: DEFAULT_COMPOSITION_FORMAT, overrides: [] };
    if (path === '/mailboxes')
      return [
        { id, email_address: 'box@example.com', aliases: [], role: 'editor', status: 'active' },
      ];
    if (path === '/signatures') return [];
    if (path === '/contacts/resolve') return { contacts: {} };
    if (path?.includes('/address-suggestions?')) return [];
    if (path?.endsWith('/submit')) {
      submitted = true;
      return {};
    }
    if (path === '/outbox' || options?.method === 'PATCH')
      saved = outboxSchema.parse(options?.body);
    if (path === '/outbox' || path === '/outbox/' + id)
      return { ...saved, id, status: 'draft', updated_at: new Date().toISOString() };
    return { settings: {} };
  });
  const open = (mode: string) =>
    render(
      <QueryClientProvider client={client}>
        <Composer mailboxId={id} mode={mode} onClose={close} onReopen={() => {}} />
      </QueryClientProvider>,
    );
  const view = open('new');
  const to = await screen.findByRole('combobox', { name: 'Para' });
  fireEvent.change(to, { target: { value: 'valido@example.com;' } });
  fireEvent.change(to, { target: { value: 'maria@' } });
  await waitFor(() => expect(saved).toBeDefined(), { timeout: 3500 });
  expect(saved?.to_addresses).toEqual([{ name: '', address: 'valido@example.com' }]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.unmount();
  open('draft:' + id);
  expect(await screen.findByRole('combobox', { name: 'Para' })).toHaveValue('maria@');
  expect(screen.getByRole('button', { name: 'Remover valido@example.com' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Revise os endereços incompletos ou inválidos em Para, Cc e Cco antes de enviar.',
  );
  expect(submitted).toBe(false);
  fireEvent.change(screen.getByRole('combobox', { name: 'Para' }), {
    target: { value: 'maria@exemplo' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(saved?.recipient_inputs?.to).toBe('maria@exemplo');
});

it.each(
  ['new', 'reply', 'forward', 'draft'].flatMap((mode) =>
    ['manual', 'auto'].map((save) => ({ mode, save })),
  ),
)(
  'preserva Para/Cc/Cco ainda em edição ao salvar $save e reabrir $mode',
  async ({ mode, save }) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(meQuery.queryKey, {
      user: { id: 'user' },
      current_tenant_id: 'tenant',
      tenants: [{ id: 'tenant', role: 'owner', access_permissions: null }],
      preferences: { timezone: 'America/Sao_Paulo' },
    });
    let saved: OutboxInput | undefined;
    const seed = outboxSchema.parse({
      mailbox_id: id,
      subject: 'Assunto preservado',
      body_html: '<p>Corpo preservado</p>',
      attachments: [{ source: 'message_attachment', attachment_id: attachmentId }],
    });
    const row = (value: OutboxInput) => ({
      ...value,
      id,
      status: 'draft',
      updated_at: new Date().toISOString(),
      attachment_metadata: [
        { id: attachmentId, filename: 'proposta.pdf', size_bytes: 100, security: clean },
      ],
    });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === '/preferences/composition')
        return { default_format: DEFAULT_COMPOSITION_FORMAT, overrides: [] };
      if (path === '/mailboxes')
        return [
          { id, email_address: 'box@example.com', aliases: [], role: 'editor', status: 'active' },
        ];
      if (path === '/signatures') return [];
      if (path === '/contacts/resolve') return { contacts: {} };
      if (path?.includes('/address-suggestions?')) return [];
      if (path === '/outbox' || (path === '/outbox/' + id && options?.method === 'PATCH')) {
        saved = outboxSchema.parse(options?.body);
        return row(saved);
      }
      if (path === '/outbox/' + id) return row(saved ?? seed);
      if (path?.startsWith('/threads/'))
        return {
          thread: { id },
          messages: [
            {
              id,
              subject: 'Original',
              from_address: 'sender@example.com',
              from_name: 'Remetente',
              to_addresses: [],
              cc_addresses: [],
              reply_to_addresses: [],
              message_at: '2026-10-22T12:00:00Z',
              body_html: '<p>Mensagem original</p>',
              body_text: 'Mensagem original',
              attachments: [
                {
                  id: attachmentId,
                  filename: 'proposta.pdf',
                  size_bytes: 100,
                  is_inline: false,
                  security: clean,
                },
              ],
            },
          ],
        };
      return { settings: {} };
    });
    const open = (composerMode: string) =>
      render(
        <QueryClientProvider client={client}>
          <Composer
            mailboxId={id}
            threadId={id}
            mode={composerMode}
            onClose={() => {}}
            onReopen={() => {}}
          />
        </QueryClientProvider>,
      );
    const view = open(mode === 'new' ? 'new' : mode + ':' + id);
    await screen.findByRole('combobox', { name: 'Para' });
    fireEvent.click(screen.getByRole('button', { name: 'Cc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cco' }));
    for (const label of ['Para', 'Cc', 'Cco']) {
      fireEvent.change(screen.getByRole('combobox', { name: label }), {
        target: { value: `${label.toLowerCase()}@example.com` },
      });
    }
    fireEvent.change(screen.getByLabelText('Assunto'), { target: { value: 'Assunto preservado' } });
    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: '<p>Corpo preservado</p>' },
    });
    if (save === 'manual') fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(saved).toBeDefined(), { timeout: 3500 });
    expect(saved?.to_addresses.at(-1)?.address).toBe('para@example.com');
    expect(saved?.cc_addresses).toEqual([{ name: '', address: 'cc@example.com' }]);
    expect(saved?.bcc_addresses).toEqual([{ name: '', address: 'cco@example.com' }]);
    expect(saved?.body_html).toContain('<p>Corpo preservado</p>');
    if (mode === 'forward') expect(saved?.body_html).toContain('Mensagem original');
    if (mode === 'forward' || mode === 'draft')
      expect(saved?.attachments).toEqual(seed.attachments);
    view.unmount();
    open('draft:' + id);
    for (const address of ['para@example.com', 'cc@example.com', 'cco@example.com']) {
      expect(await screen.findByRole('button', { name: 'Remover ' + address })).toBeVisible();
    }
    expect(screen.getByLabelText('Assunto')).toHaveValue('Assunto preservado');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('<p>Corpo preservado</p>');
    if (mode === 'forward' || mode === 'draft')
      expect(screen.getByText('proposta.pdf (1 KB)')).toBeVisible();
  },
);
