import { it, expect } from 'vitest';
import { normalizeSubject, isAutomated, socketRedisKey } from '../src/index.js';
it('normaliza cadeias internacionais sem modificar assunto interno', () => {
  for (const prefix of ['AW: WG: RV:', 'TR: FW[2]: FWD:', 'Re: RES: ENC:'])
    expect(normalizeSubject(prefix + '  Solicitação  urgente ')).toBe('solicitacao urgente');
  expect(normalizeSubject('Revisão: protocolo 42')).toBe('revisao: protocolo 42');
});
it('detecta automação por cabeçalhos, remetentes e valores vazios', () => {
  expect(isAutomated('cliente@empresa.local', { 'Auto-Submitted': ' NO ' })).toBe(false);
  expect(isAutomated('cliente@empresa.local', { 'Auto-Submitted': '' })).toBe(true);
  for (const from of [
    'noreply',
    'no-reply',
    'nao-responda',
    'naoresponda',
    'mailer-daemon',
    'postmaster',
  ])
    expect(isAutomated(from + '@empresa.local', {})).toBe(true);
  const automatedHeaders: Record<string, string>[] = [
    { Precedence: ' BULK ' },
    { 'List-Id': '' },
    { 'List-Unsubscribe': '' },
  ];
  for (const headers of automatedHeaders)
    expect(isAutomated('cliente@empresa.local', headers)).toBe(true);
});
it('isola canais de desenvolvimento e teste sem incorporar credenciais da conexão', () => {
  const dev = socketRedisKey('redis://usuario:segredo@localhost:6379/0'),
    test = socketRedisKey('redis://usuario:segredo@localhost:6379/1');
  expect(dev).not.toBe(test);
  expect(dev).not.toContain('segredo');
  expect(test).not.toContain('usuario');
  expect(socketRedisKey('redis://localhost:6379')).toBe(dev);
});
