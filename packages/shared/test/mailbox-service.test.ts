import { expect, it } from 'vitest';
import { can } from '../src/permissions.js';
import { mailboxRoleSchema, tenantSettingsSchema, mailboxSchema } from '../src/schemas/auth.js';
it('supervisor opera atendimento e acompanha dashboard sem administrar a caixa', () => {
  expect(mailboxRoleSchema.safeParse('supervisor').success).toBe(true);
  for (const p of [
    'read',
    'send',
    'note',
    'queue',
    'assign_self',
    'assign_others',
    'dashboard',
  ] as const)
    expect(can('supervisor', p)).toBe(true);
  for (const p of ['organize', 'rules', 'move', 'delete', 'cancel_any'] as const)
    expect(can('supervisor', p)).toBe(false);
});
it('mantém a restrição dos operadores como configuração explícita da empresa', () => {
  expect(tenantSettingsSchema.parse({ restrict_operators_to_assigned: true })).toEqual({
    restrict_operators_to_assigned: true,
  });
});
it('inclui configuração por caixa sem mudar o padrão das caixas existentes', () => {
  const fields = mailboxSchema.pick({ box_type: true, owner_user_id: true, queues_enabled: true });
  expect(fields.parse({})).toEqual({
    box_type: 'global',
    owner_user_id: null,
    queues_enabled: true,
  });
});
