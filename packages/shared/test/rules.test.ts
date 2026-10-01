import { describe, it, expect } from 'vitest';
import {
  evaluateConditions,
  mailRuleSchema,
  ruleConditionSchema,
  type RuleMessage,
  type RuleCondition,
} from '../src/rules.js';
const msg: RuleMessage = {
  from_name: 'José Cliente',
  from_address: 'cliente@cliente.local',
  to_addresses: [{ name: 'Comercial', address: 'comercial@apmail.local' }],
  cc_addresses: [{ name: 'María', address: 'maria@cliente.local' }],
  subject: 'Orçamento aprovado',
  body_text: 'A solução está disponível. Obrigado!',
  has_attachments: true,
};
describe('regras de e-mail', () => {
  it.each([
    ['contains', 'ORCAMENTO', true],
    ['not_contains', 'urgente', true],
    ['not_contains', 'orcamento', false],
    ['equals', 'orcamento aprovado', true],
    ['equals', 'orcamento', false],
    ['starts_with', 'Orca', true],
    ['ends_with', 'APROVADO', true],
  ] as const)('compara %s sem acentos e maiúsculas', (operator, value, result) =>
    expect(
      evaluateConditions(
        { match_mode: 'all', conditions: [{ field: 'subject', operator, value }] },
        msg,
      ),
    ).toBe(result),
  );
  it('compara remetente, destinatários, corpo, anexos e all/any', () => {
    for (const [field, value] of [
      ['from', 'JOSE'],
      ['to', 'comercial@'],
      ['cc', 'MARIA'],
      ['any_recipient', 'maria@'],
      ['body', 'SOLUCAO'],
    ] as const)
      expect(
        evaluateConditions(
          { match_mode: 'all', conditions: [{ field, operator: 'contains', value }] },
          msg,
        ),
      ).toBe(true);
    const conditions: RuleCondition[] = [
      { field: 'has_attachment', operator: 'is_true' },
      { field: 'subject', operator: 'equals', value: 'inexistente' },
    ];
    expect(evaluateConditions({ match_mode: 'all', conditions }, msg)).toBe(false);
    expect(evaluateConditions({ match_mode: 'any', conditions }, msg)).toBe(true);
    expect(
      evaluateConditions(
        { match_mode: 'all', conditions: [{ field: 'has_attachment', operator: 'is_false' }] },
        msg,
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        {
          match_mode: 'all',
          conditions: [{ field: 'body', operator: 'contains', value: 'limite' }],
        },
        { ...msg, body_text: 'a'.repeat(100000) + 'limite' },
      ),
    ).toBe(false);
  });
  it('rejeita valores vazios, operadores booleanos em texto e ações de outro escopo', () => {
    expect(
      ruleConditionSchema.safeParse({ field: 'subject', operator: 'contains', value: '  ' })
        .success,
    ).toBe(false);
    expect(ruleConditionSchema.safeParse({ field: 'body', operator: 'is_true' }).success).toBe(
      false,
    );
    const rule = {
      mailbox_id: '00000000-0000-4000-8000-000000000001',
      scope: 'personal',
      name: 'Regra',
      is_active: true,
      priority: 100,
      match_mode: 'all',
      conditions: [{ field: 'has_attachment', operator: 'is_true' }],
      actions: [{ type: 'exclude_from_queue' }],
      stop_processing: false,
    };
    expect(mailRuleSchema.safeParse(rule).success).toBe(false);
    expect(mailRuleSchema.safeParse({ ...rule, scope: 'mailbox' }).success).toBe(true);
  });
});
