import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { conversationPdf, type ConversationPdfDocument } from '../src/modules/conversation-pdf.js';

const conversation: ConversationPdfDocument = {
  subject: 'Proposta de atendimento',
  messages: [
    {
      id: 'message-1',
      message_id_header: '<original@example.com>',
      subject: 'Proposta de atendimento',
      from_address: 'ana@example.com',
      from_name: 'Ana',
      to_addresses: [{ address: 'equipe@example.com', name: 'Equipe' }],
      cc_addresses: [{ address: 'copia@example.com' }],
      bcc_addresses: [{ address: 'oculta@example.com' }],
      message_at: new Date('2026-10-27T15:30:00Z'),
      body_text: '',
      body_html:
        '<p>Olá <strong>Equipe</strong>,</p><p><em>Confira</em> <a href="https://example.com/proposta">a proposta</a>.</p><table><tr><th>Item</th><th>Valor</th></tr><tr><td>Suporte</td><td>150,00</td></tr></table><script>segredo-script</script><img src="http://tracker.test/x" alt="Logo do remetente">',
      attachments: [{ id: 'attachment-1', filename: 'proposta.pdf' }],
    },
  ],
};

// Read PDFKit's actual compressed text operators without adding a PDF parser dependency.
function pdfText(pdf: Buffer): string {
  const source = pdf.toString('latin1');
  const objects = new Map(
    [...source.matchAll(/(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
  const fonts = new Map<string, Map<number, string>>();
  for (const match of source.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const unicodeRef = objects.get(match[2]!)?.match(/\/ToUnicode (\d+) 0 R/)?.[1];
    if (!unicodeRef) continue;
    const stream = objects.get(unicodeRef)?.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)?.[1];
    if (!stream) continue;
    const cmap = inflateSync(Buffer.from(stream, 'latin1')).toString();
    const mappings = new Map<number, string>();
    for (const range of cmap.matchAll(/<([0-9a-f]+)>\s*<[0-9a-f]+>\s*\[([^\]]+)\]/gi)) {
      let code = Number.parseInt(range[1]!, 16);
      for (const value of range[2]!.matchAll(/<([0-9a-f\s]+)>/gi))
        mappings.set(
          code++,
          Buffer.from(value[1]!.replaceAll(' ', ''), 'hex').swap16().toString('utf16le'),
        );
    }
    fonts.set(match[1]!, mappings);
  }
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      let stream: string;
      try {
        stream = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
      } catch {
        return '';
      }
      let font: string | undefined;
      return [...stream.matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9a-f]+)>/gi)]
        .map((part) => {
          if (part[1]) {
            font = part[1];
            return '';
          }
          const mappings = font ? fonts.get(font) : undefined;
          if (!mappings) return Buffer.from(part[2]!, 'hex').toString('latin1');
          return (part[2]!.match(/.{4}/g) ?? [])
            .map((code) => mappings.get(Number.parseInt(code, 16)) ?? '')
            .join('');
        })
        .join('');
    })
    .join('\n');
}

it('includes full correspondence metadata, rich body, attachment names and identifiers', async () => {
  const pdf = await conversationPdf(conversation);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect([...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)]).toHaveLength(1);
  const text = pdfText(pdf);
  for (const expected of [
    'ana@example.com',
    'equipe@example.com',
    'copia@example.com',
    'oculta@example.com',
    '27/10/2026',
    '12:30',
    'Equipe',
    'Confira',
    'Suporte',
    '150,00',
    'attachment-1',
    'proposta.pdf',
    'Gerado pelo APMail',
  ])
    expect(text).toContain(expected);
  expect(text).not.toContain('segredo-script');
  expect(text).toContain('Olá Equipe,');
  expect(pdf.toString('latin1')).toContain('https://example.com/proposta');
});
it('preserves Unicode in metadata, styled content, tables and attachment filenames', async () => {
  const unicode = '東京 Ж 😀';
  const pdf = await conversationPdf({
    subject: unicode,
    messages: [
      {
        ...conversation.messages[0]!,
        subject: unicode,
        from_name: unicode,
        body_html:
          '<p><b>東京</b> <em>Ж</em> 😀</p><table><tr><td>東京 😀</td><td>Ж</td></tr></table>',
        attachments: [{ id: 'unicode', filename: '東京😀.pdf' }],
      },
    ],
  });
  const text = pdfText(pdf);
  expect(text).toContain(unicode);
  expect(text).toContain('東京😀.pdf');
  expect(text).toContain('東京 😀');
});

it('paginates long bodies and includes every message without truncation', async () => {
  const pdf = await conversationPdf({
    ...conversation,
    messages: [
      {
        ...conversation.messages[0]!,
        body_html: null,
        body_text: 'Linha integral da conversa\n'.repeat(250) + 'MARCADOR FINAL',
      },
      {
        ...conversation.messages[0]!,
        id: 'message-2',
        body_html: null,
        body_text: 'ULTIMA MENSAGEM',
      },
    ],
  });
  const pages = [...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;
  expect(pages).toBeGreaterThan(2);
  const text = pdfText(pdf);
  expect([...text.matchAll(/Gerado pelo APMail/g)]).toHaveLength(pages);
  expect(text).toContain('MARCADOR FINAL');
  expect(text).toContain('ULTIMA MENSAGEM');
});
it('formats dates in the viewer timezone with an explicit timezone label', async () => {
  const text = pdfText(await conversationPdf({ ...conversation, timezone: 'UTC' }));
  expect(text).toContain('15:30');
  expect(text).toContain('(UTC)');
});
it('preserves the end of a table cell taller than one page', async () => {
  const pdf = await conversationPdf({
    ...conversation,
    messages: [
      {
        ...conversation.messages[0]!,
        body_html:
          '<table><tr><td>' +
          '<p>Conteúdo integral da célula</p>'.repeat(160) +
          'FIM DA TABELA</td></tr></table>',
      },
    ],
  });
  expect(pdfText(pdf)).toContain('FIM DA TABELA');
});
it('embeds signature images inside links and layout tables instead of an image placeholder', async () => {
  const data = await sharp({
    create: { width: 600, height: 197, channels: 3, background: '#1686a7' },
  })
    .png()
    .toBuffer();
  const source = 'https://example.com/signature.jpg';
  const pdf = await conversationPdf({
    ...conversation,
    messages: [
      {
        ...conversation.messages[0]!,
        body_html: `<p>Atenciosamente,</p><table><tr><td><a href="https://example.com"><img data-apmail-src="${source}" width="600" alt="Assinatura"/></a></td></tr></table>`,
        images: { [source]: { data, width: 600, height: 197 } },
      },
    ],
  });
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  expect(pdfText(pdf)).not.toContain('[Imagem');
  expect(pdfText(pdf)).toContain('Atenciosamente,');
});
