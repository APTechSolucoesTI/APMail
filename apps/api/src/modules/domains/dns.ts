import { Resolver } from 'node:dns/promises';
import { getDomain } from 'tldts';
import type { DomainDnsSnapshot, DnsRecordResult } from '@apmail/shared';
export type DomainDnsResolver = {
  resolveMx: (name: string) => Promise<{ exchange: string; priority: number }[]>;
  resolveNs: (name: string) => Promise<string[]>;
  resolveTxt: (name: string) => Promise<string[][]>;
};
let active = 0;
export async function inspectDomainDns(
  input: { domain: string; dkim_selector: string | null },
  injected?: DomainDnsResolver,
): Promise<DomainDnsSnapshot> {
  if (active >= 4) throw new Error('Há consultas em andamento. Tente novamente em instantes.');
  active++;
  const native = new Resolver({ timeout: 2000, tries: 1 }),
    resolver = injected ?? native;
  const timer = setTimeout(() => native.cancel(), 8000);
  const query = async (
    name: string,
    fn: () => Promise<string[]>,
    kind: string,
  ): Promise<DnsRecordResult> => {
    try {
      const values = await fn();
      if (values.length > 32 || Buffer.byteLength(JSON.stringify(values)) > 10000)
        return {
          state: 'error',
          queried_name: name,
          values: [],
          error_code: 'response_limit',
          message: 'Resposta DNS excedeu o limite de consulta.',
        };
      return {
        state: values.length ? 'present' : 'missing',
        queried_name: name,
        values,
        message: values.length
          ? `${kind} encontrado. A consulta não comprova entrega de mensagens.`
          : `Nenhum registro ${kind} encontrado.`,
      };
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
      const absent = ['ENODATA', 'ENOTFOUND'].includes(code);
      return {
        state: absent ? 'missing' : 'error',
        queried_name: name,
        values: [],
        error_code: absent
          ? 'not_found'
          : ['ETIMEOUT', 'ECANCELLED'].includes(code)
            ? 'timeout'
            : 'resolver_error',
        message: absent
          ? `Nenhum registro ${kind} encontrado.`
          : 'Não foi possível consultar. Tente novamente.',
      };
    }
  };
  const txt = async (name: string, prefix: string) =>
    (await resolver.resolveTxt(name))
      .map((v) => v.join(''))
      .filter((v) => v.toLowerCase().startsWith(prefix.toLowerCase()));
  try {
    const [mx, ns, spf, initialDmarc, dkim] = await Promise.all([
      query(
        input.domain,
        async () =>
          (await resolver.resolveMx(input.domain))
            .sort((a, b) => a.priority - b.priority)
            .map((v) => `${v.priority} ${v.exchange}`),
        'MX',
      ),
      query(input.domain, () => resolver.resolveNs(input.domain), 'NS'),
      query(input.domain, () => txt(input.domain, 'v=spf1'), 'SPF'),
      query('_dmarc.' + input.domain, () => txt('_dmarc.' + input.domain, 'v=DMARC1'), 'DMARC'),
      input.dkim_selector
        ? query(
            input.dkim_selector + '._domainkey.' + input.domain,
            () =>
              resolver
                .resolveTxt(input.dkim_selector + '._domainkey.' + input.domain)
                .then((a) => a.map((v) => v.join(''))),
            'DKIM',
          )
        : Promise.resolve<DnsRecordResult>({
            state: 'not_checked',
            queried_name: input.domain,
            values: [],
            message: 'Seletor DKIM não informado. Consulte seu provedor.',
          }),
    ]);
    let dmarc = initialDmarc;
    const org = getDomain(input.domain, { allowPrivateDomains: false });
    if (dmarc.state === 'missing' && org && org !== input.domain) {
      dmarc = await query('_dmarc.' + org, () => txt('_dmarc.' + org, 'v=DMARC1'), 'DMARC');
      if (dmarc.state === 'present') dmarc.source_domain = org;
    }
    if (spf.values.length > 1) {
      spf.state = 'invalid';
      spf.message = 'Mais de um registro SPF encontrado. Revise com seu provedor.';
    }
    if (
      dmarc.values.length > 1 ||
      (dmarc.state === 'present' &&
        !/;\s*p=(none|quarantine|reject)(?:;|\s|$)/i.test(dmarc.values[0] ?? ''))
    ) {
      dmarc.state = 'invalid';
      dmarc.message = 'Política DMARC inválida ou duplicada. Revise com seu provedor.';
    }
    if (dkim.state === 'present' && !dkim.values.some((v) => /\bp\s*=\s*[^;\s]+/.test(v))) {
      dkim.state = 'invalid';
      dkim.message = 'Chave DKIM ausente ou revogada.';
    }
    if (mx.values.some((v) => /^0 \.$/.test(v))) {
      mx.state = 'not_applicable';
      mx.message = 'O domínio publica null MX: declara que não aceita e-mails.';
    }
    return { checked_at: new Date().toISOString(), records: { mx, ns, spf, dmarc, dkim } };
  } finally {
    clearTimeout(timer);
    active--;
  }
}
