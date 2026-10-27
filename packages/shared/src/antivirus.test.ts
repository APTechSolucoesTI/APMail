import { expect, it } from 'vitest';
import { antivirusFindingKind, fileReleaseSchema } from './antivirus.js';
it('separa senha e limites de assinaturas de malware e phishing', () => {
  expect(
    antivirusFindingKind({ status: 'infected', threat_name: 'Heuristics.Encrypted.PDF' }),
  ).toBe('encrypted');
  expect(
    antivirusFindingKind({
      status: 'infected',
      threat_name: 'Heuristics.Limits.Exceeded.MaxScanSize',
    }),
  ).toBe('limits');
  for (const threat_name of [
    'Win.Trojan.Encrypted-1',
    'Heuristics.Phishing.Email.SpoofedDomain',
    'Eicar-Signature',
  ])
    expect(antivirusFindingKind({ status: 'infected', threat_name })).toBe('malware');
  expect(
    fileReleaseSchema.safeParse({
      file_ids: ['10000000-0000-4000-8000-000000000001'],
      reason: 'Fatura conferida',
    }).success,
  ).toBe(false);
});
