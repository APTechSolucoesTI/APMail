import { describe, expect, it } from 'vitest';
import { attachmentCanOpen, antivirusStatusLabel, antivirusExplanation } from './antivirus';
describe('attachment safety policy', () => {
  it('only releases explicitly clean files', () => {
    expect(attachmentCanOpen(undefined)).toBe(false);
    for (const status of ['pending', 'infected', 'error'] as const)
      expect(attachmentCanOpen({ status })).toBe(false);
    expect(attachmentCanOpen({ status: 'clean' })).toBe(true);
  });
  it('distinguishes a heuristic policy block from confirmed malware', () => {
    expect(
      antivirusStatusLabel({ status: 'infected', threat_name: 'Heuristics.Encrypted.Zip' }),
    ).toBe('Bloqueado por política');
    expect(
      antivirusExplanation({ status: 'infected', threat_name: 'Heuristics.Limits.Exceeded' }),
    ).toContain('limites');
    expect(antivirusStatusLabel({ status: 'infected', threat_name: 'Win.Test' })).toBe(
      'Ameaça detectada',
    );
    expect(antivirusStatusLabel({ status: 'error', error_code: 'size_limit' })).toBe(
      'Bloqueado por política',
    );
  });
});
