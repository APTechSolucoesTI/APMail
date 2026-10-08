import { it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipFile } from 'yazl';
import { mboxMessages, readMailArchive } from '../src/archives/read-mail-archive.js';
import { toMbox } from '../../api/src/modules/mail-archive-exports.js';
it('roundtrips mboxrd quoting, non-UTF8 bytes and multiple messages across chunk boundaries', async () => {
  const raw = Buffer.from(
    'From: a@example.com\r\nSubject: Test\r\n\r\nFrom body\r\n>From quoted\r\n\xe9\r\n',
    'latin1',
  );
  const encoded = toMbox(raw, new Date('2026-10-07T12:00:00Z'), 'a@example.com');
  const result = [];
  for await (const value of mboxMessages(
    Readable.from([encoded.subarray(0, 6), encoded.subarray(6), encoded]),
  ))
    result.push(value);
  expect(result).toHaveLength(2);
  expect(result[0]!.raw.toString('latin1')).toContain('From body\n>From quoted\n\xe9');
});
it('reads EMLX declared MIME and ZIP folders, ignoring non-mail files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apmail-archive-'));
  try {
    const mime = Buffer.from(
      'From: a@example.com\r\nTo: b@example.com\r\nSubject: Example\r\n\r\nBody',
    );
    const emlx = join(dir, 'apple.emlx');
    await writeFile(
      emlx,
      Buffer.concat([Buffer.from(mime.length + '\n'), mime, Buffer.from('\n<plist/>')]),
    );
    const items = [];
    for await (const item of readMailArchive(emlx, 'emlx')) items.push(item);
    expect(items[0]?.raw.equals(mime)).toBe(true);
    const zip = new ZipFile();
    zip.addBuffer(mime, 'Inbox/message.eml');
    zip.addBuffer(Buffer.from('ignored'), 'notes.txt');
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
    const name = join(dir, 'mail.zip');
    await writeFile(name, Buffer.concat(chunks));
    const messages = [];
    for await (const item of readMailArchive(name, 'zip')) messages.push(item);
    expect(messages).toEqual([{ folder: 'Inbox', raw: mime }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
