import { expect, it } from 'vitest';
import { archiveQuotaCheck, mailArchiveFormat, archivePreflightSchema } from './mail-archives.js';
it('blocks beyond remaining space and warns at 90% using precise byte arithmetic', () => {
  expect(archiveQuotaCheck(21n, 80n, 100n).allowed).toBe(false);
  expect(archiveQuotaCheck(10n, 80n, 100n)).toMatchObject({
    allowed: true,
    near_limit: true,
    remaining_bytes: '20',
  });
  expect(archiveQuotaCheck(9007199254740993n, 0n, null).allowed).toBe(true);
  expect(archiveQuotaCheck(1n, 0n, 0n).allowed).toBe(false);
});
it('recognizes explicit formats and rejects unsupported or empty files', () => {
  expect(mailArchiveFormat('backup.OST')).toBe('ost');
  expect(mailArchiveFormat('foo.exe')).toBe(null);
  expect(archivePreflightSchema.safeParse({ filename: 'empty.mbox', size_bytes: 0 }).success).toBe(
    false,
  );
});
