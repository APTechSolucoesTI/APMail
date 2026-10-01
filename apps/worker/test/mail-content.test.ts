import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { simpleParser } from 'mailparser';
import { sanitizeEmailHtml, htmlToText, messageSnippet } from '@apmail/db';
import { isAutomated } from '@apmail/shared';
import { allowInsecure } from '../src/imap/connect.js';
import { envSchema } from '../src/env.js';
import { connectionError } from '../src/lib/errors.js';
it('sanitiza fixture MIME, bloqueia rastreamento e preserva CID sem scripts', async () => {
  const parsed = await simpleParser(
    await readFile(new URL('./fixtures/unsafe-html.eml', import.meta.url)),
    { keepCidLinks: true },
  );
  const html = sanitizeEmailHtml(parsed.html || '');
  expect(html).not.toMatch(
    /<script|<iframe|<form|<input|onerror|javascript:|background-image|\ssrc="https/,
  );
  expect(html).toContain('data-apmail-src="https://example.com/pixel.png"');
  expect(html).toContain('data-apmail-cid="imagem-interna"');
  expect(html).toContain('noopener noreferrer nofollow');
  expect(htmlToText(html)).toContain('Conteúdo seguro');
});
it('newsletter MIME é automatizada e o snippet termina antes da citação', async () => {
  const parsed = await simpleParser(
    await readFile(new URL('./fixtures/newsletter.eml', import.meta.url)),
  );
  expect(
    isAutomated(
      parsed.from!.value[0]!.address!,
      Object.fromEntries([...parsed.headers].map(([k, v]) => [k, String(v)])),
    ),
  ).toBe(true);
  expect(messageSnippet(parsed.text!)).toBe('Novidades desta semana.');
});
it('texto é escapado e imagens de dados grandes ou vetoriais são removidas', () => {
  expect(sanitizeEmailHtml('', '<script>\nOlá')).toMatch(/&lt;script&gt;<br\s*\/?>Olá/);
  expect(
    sanitizeEmailHtml(
      '<img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:image/png;base64,' +
        'a'.repeat(210000) +
        '">',
    ),
  ).not.toContain('src=');
});
it('TLS inseguro só é permitido no desenvolvimento e para hosts explicitamente listados', () => {
  const base = {
    DATABASE_URL: 'postgres://a:a@localhost/apmail_test',
    REDIS_URL: 'redis://localhost:6379',
    APP_URL: 'http://localhost:5173',
    SESSION_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    CREDENTIALS_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  };
  expect(allowInsecure('localhost', envSchema.parse({ ...base, NODE_ENV: 'development' }))).toBe(
    true,
  );
  expect(allowInsecure('example.com', envSchema.parse({ ...base, NODE_ENV: 'development' }))).toBe(
    false,
  );
  expect(allowInsecure('localhost', envSchema.parse({ ...base, NODE_ENV: 'production' }))).toBe(
    false,
  );
  expect(connectionError({ code: 'EAUTH' }, 'localhost', 3143)).toContain(
    'Usuário ou senha inválidos',
  );
});
