import { describe, expect, it } from 'vitest';
import {
  can,
  MAILBOX_PERMS,
  normalizeSubject,
  renderFromName,
  externalParticipants,
  isAutomated,
  toBullJobId,
} from '../src/index.js';
describe('Fundação de domínio', () => {
  it('normaliza prefixos encadeados, acentos e espaços', () => {
    expect(normalizeSubject(' RES: ENC: Re[2]:  Orçamento   de TI ')).toBe('orcamento de ti');
    expect(normalizeSubject('')).toBe('');
  });
  it('respeita a matriz e nega ausência de acesso', () => {
    for (const permission of MAILBOX_PERMS) expect(can('mailbox_admin', permission)).toBe(true);
    expect(can('viewer', 'read')).toBe(true);
    expect(can('viewer', 'send')).toBe(false);
    expect(can('editor', 'organize')).toBe(false);
    expect(can(null, 'read')).toBe(false);
  });
  it('renderiza e limita o nome do remetente sem injeção de cabeçalho', () => {
    expect(
      renderFromName('{user_name} | {mailbox_name}', {
        user_name: 'Ana',
        mailbox_name: 'Comercial',
        tenant_name: 'AP',
      }),
    ).toBe('Ana | Comercial');
    expect(
      renderFromName('{user_name}', {
        user_name: 'x'.repeat(110) + '\r\n"',
        mailbox_name: '',
        tenant_name: '',
      }),
    ).toHaveLength(100);
  });
  it('remove endereços próprios e duplicados', () => {
    expect(
      externalParticipants(
        {
          from_address: 'CLIENTE@exemplo.com',
          to_addresses: [{ name: '', address: 'NOS@ap.com' }],
          cc_addresses: [{ name: '', address: 'cliente@exemplo.com' }],
        },
        ['nos@ap.com'],
      ),
    ).toEqual(['cliente@exemplo.com']);
  });
  it('reconhece automação sem confundir Auto-Submitted=no', () => {
    expect(isAutomated('pessoa@exemplo.com', { 'Auto-Submitted': 'no' })).toBe(false);
    expect(
      isAutomated('pessoa@exemplo.com', { 'List-Unsubscribe': 'mailto:sair@exemplo.com' }),
    ).toBe(true);
    expect(isAutomated('no-reply@exemplo.com', {})).toBe(true);
  });
  it('adapta o ID ao BullMQ sem perder a identidade', () =>
    expect(toBullJobId('outbox:uuid:1')).toBe('outbox~uuid~1'));
});
