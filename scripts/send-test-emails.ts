import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { createDb, loadRootEnv } from '../packages/db/src/index.js';
import { transports } from '../apps/worker/src/imap/connect.js';
import { readEnv } from '../apps/worker/src/env.js';
loadRootEnv();
if (process.env.NODE_ENV === 'production')
  throw new Error('E-mails de teste não podem ser enviados em produção.');
const to = process.argv.includes('--to')
  ? process.argv[process.argv.indexOf('--to') + 1]
  : 'comercial';
const recipient =
  to === 'suporte' ? 'suporte@apmail.local' : to === 'comercial' ? 'comercial@apmail.local' : to;
if (!recipient?.endsWith('@apmail.local'))
  throw new Error('Destinatário de teste deve usar apmail.local.');
const smtp = nodemailer.createTransport({
  host: 'localhost',
  port: 3025,
  secure: false,
  ignoreTLS: true,
});
const from = 'Cliente de teste <cliente@cliente.local>';
try {
  const setupDb = createDb(process.env.DATABASE_URL!);
  try {
    const box = await setupDb
      .selectFrom('mailboxes')
      .selectAll()
      .where('email_address', '=', recipient)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    if (box.imap_host !== 'localhost' || box.imap_port !== 3143)
      throw new Error('A caixa de teste deve usar o GreenMail local.');
    const t = await transports(setupDb, box, readEnv());
    try {
      await t.imap.connect();
      const paths = new Set((await t.imap.list()).map((f) => f.path));
      for (const folder of ['Sent', 'Drafts', 'Archive', 'Junk', 'Trash'])
        if (!paths.has(folder)) await t.imap.mailboxCreate(folder);
    } finally {
      await t.close();
    }
  } finally {
    await setupDb.destroy();
  }
  if (process.argv.includes('--reply-last')) {
    const db = createDb(process.env.DATABASE_URL!);
    try {
      const box = await db
        .selectFrom('mailboxes')
        .select(['id', 'tenant_id'])
        .where('email_address', '=', recipient)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const last = await db
        .selectFrom('messages')
        .select(['message_id_header', 'references_headers', 'subject'])
        .where('tenant_id', '=', box.tenant_id)
        .where('mailbox_id', '=', box.id)
        .where('direction', '=', 'outbound')
        .where('deleted_at', 'is', null)
        .orderBy('message_at', 'desc')
        .executeTakeFirstOrThrow();
      await smtp.sendMail({
        from,
        to: recipient,
        subject: 'Re: ' + last.subject,
        inReplyTo: last.message_id_header,
        references: [...last.references_headers, last.message_id_header].slice(-20),
        text: 'Obrigado pela resposta. Tenho uma nova pergunta sobre o atendimento.',
        messageId: `<${randomUUID()}@cliente.local>`,
      });
      console.info('Resposta do cliente entregue ao GreenMail.');
    } finally {
      await db.destroy();
    }
  } else {
    for (const subject of ['Pedido de compra', 'Acesso ao projeto', 'Orçamento']) {
      const parent = `<${randomUUID()}@cliente.local>`;
      await smtp.sendMail({
        from,
        to: recipient,
        subject,
        text: 'Olá, equipe. Preciso de ajuda com ' + subject + '.',
        messageId: parent,
      });
      await smtp.sendMail({
        from,
        to: recipient,
        subject: 'Re: ' + subject,
        text: 'Complementando a solicitação: seguem mais informações.\n\n> Olá, equipe. Preciso de ajuda.',
        inReplyTo: parent,
        references: [parent],
        messageId: `<${randomUUID()}@cliente.local>`,
      });
    }
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cJcAAAAASUVORK5CYII=',
      'base64',
    );
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
    );
    const examples = [
      {
        subject: 'Informações da reunião — ação e solução',
        text: 'Atenção: reunião amanhã. São Paulo, orçamento e soluções. Anexo PDF.',
        attachments: [
          { filename: 'Informações.pdf', content: pdf, contentType: 'application/pdf' },
        ],
      },
      {
        subject: 'Imagem incorporada',
        html: '<p>Imagem interna da solicitação:</p><img src="cid:imagem-qa" alt="Imagem interna">',
        attachments: [
          {
            filename: 'imagem.png',
            content: png,
            cid: 'imagem-qa',
            contentDisposition: 'inline' as const,
          },
        ],
      },
      {
        subject: 'HTML e privacidade',
        html: '<p>Conteúdo seguro.</p><script>window.__apmail_xss=true</script><img src="https://example.com/tracking.png" alt="Imagem externa"><a href="javascript:alert(1)">Link inválido</a>',
      },
      {
        subject: 'Newsletter semanal',
        text: 'Novidades automatizadas da semana.',
        headers: { 'List-Unsubscribe': '<mailto:unsubscribe@cliente.local>', Precedence: 'bulk' },
      },
      {
        subject: 'RES: ENC: Re: Orçamento',
        text: 'Mais uma resposta sobre o orçamento solicitado.',
      },
      { subject: '', text: 'Uma mensagem sem assunto também precisa ser exibida.' },
    ];
    for (const example of examples)
      await smtp.sendMail({
        from,
        to: recipient,
        messageId: `<${randomUUID()}@cliente.local>`,
        ...example,
      });
    console.info('12 e-mails entregues ao GreenMail para ' + recipient + '.');
  }
} finally {
  smtp.close();
}
