import { it, expect } from 'vitest';
import { normalizeDomain } from './domains.js';
import { queuesEnabled } from './mail-policy.js';
it('normalizes a domain without accepting a URL, IP or port', () => {
  expect(normalizeDomain(' APTechInfo.COM.BR. ')).toBe('aptechinfo.com.br');
  for (const value of [
    'https://example.com',
    '127.0.0.1',
    'example.com:443',
    '*.example.com',
    'a@b.com',
  ])
    expect(() => normalizeDomain(value)).toThrow();
  expect(normalizeDomain('ação.com.br')).toBe('xn--ao-siap.com.br');
});
it('uses the company policy and preserves the enabled default', () => {
  expect(queuesEnabled({ mail_queues_enabled: false })).toBe(false);
  expect(queuesEnabled({})).toBe(true);
  expect(queuesEnabled(null)).toBe(true);
});
