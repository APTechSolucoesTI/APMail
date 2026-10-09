import { it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { byteLines } from '../src/archives/read-mail-archive.js';

it('preserves lines across arbitrary binary/UTF8 chunk boundaries and the unterminated tail', async () => {
  const raw = Buffer.from('Olá\r\n\nação\nfinal');
  const chunks = Array.from(raw, (byte) => Buffer.from([byte]));
  const lines = [];
  for await (const line of byteLines(Readable.from(chunks))) lines.push(line.toString());
  expect(lines).toEqual(['Olá\r\n', '\n', 'ação\n', 'final']);
});

it('bounds a line before concatenation, whether split between chunks or arriving in one chunk', async () => {
  for (const chunks of [[Buffer.from('12345\n')], [Buffer.from('123'), Buffer.from('45')]]) {
    await expect(
      (async () => {
        for await (const line of byteLines(Readable.from(chunks), 4)) void line;
      })(),
    ).rejects.toThrow('limite de leitura');
  }
});

it('does not drain an eager producer while its consumer is paused', async () => {
  let produced = 0;
  const input = Readable.from(
    (function* () {
      for (let index = 0; index < 1000; index++) {
        produced++;
        yield Buffer.from('message\n');
      }
    })(),
    { highWaterMark: 1 },
  );
  const lines = byteLines(input);
  expect((await lines.next()).value?.toString()).toBe('message\n');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(produced).toBeLessThanOrEqual(2);
  await lines.return(undefined);
  expect(input.destroyed).toBe(true);
});
