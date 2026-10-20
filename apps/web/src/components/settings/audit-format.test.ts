import { expect, it } from 'vitest';
import { actionLabel, humanValue, auditOutcome } from './audit-format';
it('apresenta destinatários, permissões e alterações em linguagem de operação', () => {
  expect(humanValue([{ address: 'ana@cliente.example', name: 'Ana' }])).toBe(
    'Ana — ana@cliente.example',
  );
  expect(humanValue(['users.invite', 'audit.content'])).toBe(
    'Convidar usuários, Consultar conteúdo auditado',
  );
  expect(humanValue(false)).toBe('Não');
  expect(actionLabel('message.replied')).toBe('E-mail respondido');
  expect(humanValue('qa-user', { 'qa-user': 'Ana Ferreira' })).toBe('Ana Ferreira');
});
it('distingue solicitação e falha sem afirmar conclusão antecipada', () => {
  const entry = {
    action: 'message.delete_requested',
    metadata: { outcome: 'requested' },
  };
  expect(auditOutcome(entry).label).toBe('Solicitado');
  expect(auditOutcome({ ...entry, action: 'mail_action.failed', metadata: {} }).label).toBe(
    'Falhou',
  );
});
