import { it, expect } from 'vitest';
import { simpleParser } from 'mailparser';
import { readAutoReplyTarget } from '../src/lib/auto-reply.js';
const own = ['owner@example.com', 'alias@example.com'];
async function read(
  extra = '',
  path = 'Return-Path: <sender@example.net>\r\n',
  to = 'owner@example.com',
) {
  return readAutoReplyTarget(
    await simpleParser(
      path +
        'From: Sender <sender@example.net>\r\nTo: ' +
        to +
        '\r\nReply-To: attacker@example.org\r\n' +
        extra +
        'Subject: Olá\r\n\r\nMensagem',
    ),
    own,
  );
}
it('usa Return-Path e ignora Reply-To; reconhece aliases', async () => {
  expect(await read()).toBe('sender@example.net');
  expect(await read('', '', 'owner@example.com')).toBeNull();
  expect(await read('', 'Return-Path: <sender@example.net>\r\n', 'alias@example.com')).toBe(
    'sender@example.net',
  );
  expect(await read('Auto-Submitted: no\r\n')).toBe('sender@example.net');
});
it.each([
  'Auto-Submitted: auto-replied',
  'Auto-Submitted: auto-generated',
  'Precedence: bulk',
  'List-Id: list.example.com',
  'X-Auto-Response-Suppress: All',
  'Content-Type: multipart/report; report-type=delivery-status',
  'Newsgroups: news.example',
  'Auto-Submitted: no\r\nAuto-Submitted: no',
])('não responde a %s', async (extra) => expect(await read(extra + '\r\n')).toBeNull());
it.each([
  '<>',
  '<owner@example.com>',
  '<mailer-daemon@example.net>',
  '<bad>',
  '<one@example.net>, <two@example.net>',
])('rejeita retorno inseguro %s', async (path) =>
  expect(await read('', 'Return-Path: ' + path + '\r\n')).toBeNull(),
);
it('não responde a mensagens destinadas a outra pessoa nem retorno duplicado', async () => {
  expect(await read('', 'Return-Path: <sender@example.net>\r\n', 'other@example.org')).toBeNull();
  expect(await read('Return-Path: <other@example.org>\r\n')).toBeNull();
});
