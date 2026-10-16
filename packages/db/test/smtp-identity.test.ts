import { describe, expect, it } from 'vitest';
import { normalizeSmtpHelloName, smtpHelloName } from '../src/smtp-identity.js';

describe('identificação SMTP', () => {
  it('deriva o nome público de APP_URL sem porta ou caminho e permite substituição explícita', () => {
    expect(
      smtpHelloName({ APP_URL: 'https://app.apmail.com.br:75/settings', NODE_ENV: 'production' }),
    ).toBe('app.apmail.com.br');
    expect(
      smtpHelloName({
        APP_URL: 'http://localhost:3001',
        SMTP_EHLO_NAME: 'SMTP.Aptechinfo.com.br.',
      }),
    ).toBe('smtp.aptechinfo.com.br');
    expect(normalizeSmtpHelloName('reunião.apmail.com.br')).toBe('xn--reunio-7ta.apmail.com.br');
  });
  it.each([
    '127.0.0.1',
    '[127.0.0.1]',
    '127.1',
    '10.0.0.1',
    '192.168.3.106',
    '172.16.0.1',
    '100.64.0.1',
    '169.254.1.1',
    '0.0.0.0',
    '255.255.255.255',
    '::1',
    '[IPv6:::1]',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
    'localhost',
    'container123',
    'host.local',
    'localhost.localdomain',
    'https://app.apmail.com.br',
    'app.apmail.com.br:75',
    'app.apmail.com.br\r\nMAIL FROM:bad@example.com',
    'app.apmail.com.br x',
    'x_helo.example.com',
    '-a.example.com',
  ])('rejeita identificação local ou inválida: %s', (value) => {
    expect(normalizeSmtpHelloName(value)).toBeNull();
  });
  it('formata IPs públicos como literais SMTP válidos', () => {
    expect(normalizeSmtpHelloName('93.184.216.34')).toBe('[93.184.216.34]');
    expect(normalizeSmtpHelloName('[93.184.216.34]')).toBe('[93.184.216.34]');
    expect(normalizeSmtpHelloName('2606:4700:4700::1111')).toBe('[IPv6:2606:4700:4700::1111]');
    expect(normalizeSmtpHelloName('[IPv6:2606:4700:4700::1111]')).toBe(
      '[IPv6:2606:4700:4700::1111]',
    );
  });
  it('impede fallback silencioso para loopback em produção e conserva testes locais', () => {
    expect(() => smtpHelloName({ APP_URL: 'http://localhost', NODE_ENV: 'production' })).toThrow(
      'SMTP_EHLO_NAME',
    );
    expect(() =>
      smtpHelloName({ APP_URL: 'https://app.apmail.com.br', SMTP_EHLO_NAME: '[127.0.0.1]' }),
    ).toThrow('SMTP_EHLO_NAME');
    expect(smtpHelloName({ APP_URL: 'http://localhost', NODE_ENV: 'test' })).toBe('apmail.test');
  });
});
