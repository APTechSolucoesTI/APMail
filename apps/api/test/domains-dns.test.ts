import { it, expect } from 'vitest';
import { inspectDomainDns } from '../src/modules/domains/dns.js';
it('distinguishes missing selector and inherited DMARC from a resolver failure', async () => {
  const resolver = {
    resolveMx: async () => [],
    resolveNs: async () => ['ns.example.test'],
    resolveTxt: async (name: string) =>
      name === '_dmarc.example.com.br' ? [['v=DMARC1; p=reject']] : [],
  };
  const result = await inspectDomainDns(
    { domain: 'mail.example.com.br', dkim_selector: null },
    resolver,
  );
  expect(result.records.dkim.state).toBe('not_checked');
  expect(result.records.dmarc.source_domain).toBe('example.com.br');
  expect(result.records.mx.message).not.toContain('não recebe');
  const failed = await inspectDomainDns(
    { domain: 'example.com', dkim_selector: null },
    {
      ...resolver,
      resolveMx: async () => {
        throw Object.assign(new Error(), { code: 'ETIMEOUT' });
      },
    },
  );
  expect(failed.records.mx.error_code).toBe('timeout');
});
