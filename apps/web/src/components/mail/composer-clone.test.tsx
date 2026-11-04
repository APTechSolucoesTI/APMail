import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_COMPOSITION_FORMAT, outboxSchema, type OutboxInput } from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { Composer } from './composer';
import { pendingSecurity } from '@/lib/antivirus';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/components/forms/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value: string }) => (
    <textarea aria-label="Mensagem" value={value} readOnly />
  ),
}));
const id = '123e4567-e89b-42d3-a456-426614174000';
const file = '123e4567-e89b-42d3-a456-426614174001';
beforeEach(() => vi.mocked(api).mockReset());
it('reidrata a imagem CID no editor real usando a permissão do anexo original', async () => {
  const { RichTextEditor } = await vi.importActual<
    typeof import('@/components/forms/rich-text-editor')
  >('@/components/forms/rich-text-editor');
  vi.mocked(api).mockResolvedValue({ ...pendingSecurity, status: 'clean' });
  render(
    <RichTextEditor
      value={'<p>Texto</p><img data-apmail-cid="Logo" alt="Imagem da assinatura">'}
      attachmentIdsByCid={{ logo: file }}
      onChange={() => {}}
    />,
  );
  const image = await screen.findByRole('img', { name: 'Imagem da assinatura' });
  expect(image).toHaveAttribute('src', '/api/attachments/' + file + '/inline');
});
it.each([true, false])(
  'clona corpo html=%s, assinatura e apenas imagens usadas no corpo',
  async (html) => {
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
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === '/preferences/composition')
        return { default_format: DEFAULT_COMPOSITION_FORMAT, overrides: [] };
      if (path === '/mailboxes')
        return [
          { id, email_address: 'box@example.com', aliases: [], role: 'editor', status: 'active' },
        ];
      if (path === '/signatures')
        return [
          {
            id: file,
            is_default: true,
            mailbox_id: id,
            body_html: '<p>Assinatura padrão nova</p>',
          },
        ];
      if (path === '/contacts/resolve') return { contacts: {} };
      if (path === '/threads/' + id)
        return {
          thread: { id },
          messages: [
            {
              id,
              subject: 'Re: Proposta original',
              to_addresses: [{ name: 'Ana', address: 'ana@example.com' }],
              cc_addresses: [{ name: 'Bruno', address: 'bruno@example.com' }],
              bcc_addresses: [{ name: 'Carla', address: 'carla@example.com' }],
              body_html: html
                ? '<p>Corpo original</p><img src="cid:imagem"><div data-apmail-signature="original">Assinatura original<img data-apmail-cid="assinatura"></div>'
                : null,
              body_text: 'Linha um\nLinha <dois>',
              attachments: [
                { id: file, filename: 'arquivo.pdf', is_inline: false },
                {
                  id,
                  filename: 'imagem.png',
                  content_id: 'imagem',
                  content_type: 'image/png',
                  is_inline: true,
                },
                {
                  id: '123e4567-e89b-42d3-a456-426614174002',
                  filename: 'assinatura.png',
                  content_id: 'assinatura',
                  content_type: 'image/png',
                  is_inline: false,
                },
              ],
            },
          ],
        };
      if (path === '/outbox') {
        saved = outboxSchema.parse(options?.body);
        return { ...saved, id: file, status: 'draft' };
      }
      return { settings: {} };
    });
    render(
      <QueryClientProvider client={client}>
        <Composer
          mailboxId={id}
          threadId={id}
          mode={'clone:' + id}
          onClose={() => {}}
          onReopen={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText('Assunto')).toHaveValue('Re: Proposta original');
    for (const address of ['ana', 'bruno', 'carla'])
      expect(
        screen.getByRole('button', { name: 'Remover ' + address + '@example.com' }),
      ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Salvar$/ }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({
      kind: 'new',
      attachments: html
        ? [
            { source: 'message_attachment', attachment_id: id, inline: true },
            {
              source: 'message_attachment',
              attachment_id: '123e4567-e89b-42d3-a456-426614174002',
              inline: true,
            },
          ]
        : [],
      subject: 'Re: Proposta original',
      signature_id: null,
    });
    expect(saved?.thread_id).toBeFalsy();
    expect(saved?.source_thread_id).toBeFalsy();
    expect(saved?.reply_to_message_id).toBeFalsy();
    if (html) {
      expect(saved?.body_html).toContain('data-apmail-cid="imagem"');
      expect(saved?.body_html).toContain('data-apmail-cid="assinatura"');
    }
    expect(saved?.body_html).not.toContain('data-apmail-quote');
    expect(saved?.body_html).not.toContain('Assinatura padrão nova');
    const body = new DOMParser().parseFromString(saved!.body_html, 'text/html');
    expect(body.body.textContent).toBe(
      html ? 'Corpo originalAssinatura original' : 'Linha um\nLinha <dois>',
    );
  },
);
