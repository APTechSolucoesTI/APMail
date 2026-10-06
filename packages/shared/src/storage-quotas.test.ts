import { expect, it } from 'vitest';
import {
  storageAmountBytes,
  storageBytesAmount,
  storagePercentageBytes,
  storageBytesSchema,
} from './storage-quotas.js';
it('converte unidades e percentuais sem perda de precisão acima de 2^53', () => {
  expect(storageAmountBytes('50', 'GB')).toBe('50000000000');
  expect(storageAmountBytes('1,5', 'GiB')).toBe('1610612736');
  expect(storageAmountBytes('9007199254740993', 'B')).toBe('9007199254740993');
  expect(storagePercentageBytes('33,3333', '1000000')).toBe('333333');
  for (const unit of ['GB', 'GiB', 'TB', 'TiB'] as const)
    expect(storageAmountBytes(storageBytesAmount('9007199254740993', unit), unit)).toBe(
      '9007199254740993',
    );
  expect(() => storageAmountBytes('-1', 'GB')).toThrow();
  expect(() => storagePercentageBytes('101', '100')).toThrow();
  expect(() => storageAmountBytes('9223372036854775808', 'B')).toThrow();
  for (const invalid of ['abc', '-1', '1.5', '9'.repeat(20), ''])
    expect(storageBytesSchema.safeParse(invalid).success).toBe(false);
});
