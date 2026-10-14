import { it, expect } from 'vitest';
import { simpleParser } from 'mailparser';
import { buildMdn, readMdnRequest, isMdnReport } from '../src/lib/mdn.js';
import { parseMdnFields } from '@apmail/shared';
const box = { email_address: 'recipient@example.com', aliases: ['alias@example.com'] };
const raw = (extra = '') =>
  Buffer.from(
    'From: Sender <sender@example.com>\r\nTo: recipient@example.com\r\nMessage-ID: <original@example.com>\r\nReturn-Path: <sender@example.com>\r\nDisposition-Notification-To: sender@example.com\r\n' +
      extra +
      'Content-Type: text/plain\r\n\r\nRead me',
  );
it('gera multipart/report real, envelope nulo e campos RFC 8098 sem requisição recursiva', async () => {
  const request = readMdnRequest(await simpleParser(raw()), box)!;
  expect(request).toEqual({
    to: 'sender@example.com',
    recipient: box.email_address,
    original_message_id: '<original@example.com>',
    return_path_matches: true,
  });
  const mime = buildMdn(request),
    parsed = await simpleParser(mime.raw);
  expect(mime.envelope.from).toBe('');
  expect(mime.envelope.to).toEqual(['sender@example.com']);
  expect(isMdnReport(parsed)).toBe(true);
  expect(parsed.headers.has('disposition-notification-to')).toBe(false);
  expect(parsed.attachments).toHaveLength(1);
  expect(parsed.attachments[0]!.contentType).toBe('message/disposition-notification');
  expect(parseMdnFields(parsed.attachments[0]!.content.toString())?.disposition).toBe('displayed');
  expect(readMdnRequest(parsed, box)).toBeNull();
});
it('rejeita cabeçalhos duplicados, loops, retorno vazio, endereços inválidos e extensões obrigatórias', async () => {
  for (const extra of [
    'Disposition-Notification-To: evil@example.com\r\n',
    'Disposition-Notification-Options: x-policy=required,yes\r\n',
    'Auto-Submitted: auto-replied\r\n',
    'List-ID: newsletter.example.com\r\n',
  ])
    expect(readMdnRequest(await simpleParser(raw(extra)), box)).toBeNull();
  for (const value of [
    raw().toString().replace('sender@example.com\r\nContent-Type', 'bad\r\nContent-Type'),
    raw().toString().replace('Return-Path: <sender@example.com>', 'Return-Path: <>'),
  ])
    expect(readMdnRequest(await simpleParser(value), box)).toBeNull();
  const mismatch = readMdnRequest(
    await simpleParser(
      raw()
        .toString()
        .replace('Return-Path: <sender@example.com>', 'Return-Path: <different@example.com>'),
    ),
    box,
  );
  expect(mismatch?.return_path_matches).toBe(false);
});
