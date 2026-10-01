import { z } from 'zod';
import type { Address } from './threading.js';
export const LABEL_COLORS = [
  'teal',
  'blue',
  'indigo',
  'green',
  'amber',
  'red',
  'slate',
  'cyan',
] as const;
export const personalLabelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(LABEL_COLORS),
});
export const ruleConditionSchema = z
  .object({
    field: z.enum(['from', 'to', 'cc', 'any_recipient', 'subject', 'body', 'has_attachment']),
    operator: z.enum([
      'contains',
      'not_contains',
      'equals',
      'starts_with',
      'ends_with',
      'is_true',
      'is_false',
    ]),
    value: z.string().trim().max(200).optional(),
  })
  .refine(
    (c) =>
      c.field === 'has_attachment'
        ? ['is_true', 'is_false'].includes(c.operator)
        : !['is_true', 'is_false'].includes(c.operator) && !!c.value,
    { message: 'Escolha um operador e valor válidos para o campo.' },
  );
export const mailboxRuleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move_to_folder'), folder_id: z.uuid() }),
  z.object({ type: z.literal('mark_flagged') }),
  z.object({ type: z.literal('assign_to'), user_id: z.uuid() }),
  z.object({ type: z.literal('exclude_from_queue') }),
  z.object({
    type: z.literal('forward_to'),
    address: z
      .email()
      .max(254)
      .transform((a) => a.toLowerCase()),
  }),
]);
export const personalRuleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_label'), label_id: z.uuid() }),
  z.object({ type: z.literal('pin') }),
]);
export const mailRuleSchema = z
  .object({
    id: z.uuid().optional(),
    mailbox_id: z.uuid(),
    scope: z.enum(['mailbox', 'personal']),
    name: z.string().trim().min(2).max(80),
    is_active: z.boolean(),
    priority: z.number().int().min(1).max(999),
    match_mode: z.enum(['all', 'any']),
    conditions: z.array(ruleConditionSchema).min(1).max(10),
    actions: z
      .array(z.union([mailboxRuleActionSchema, personalRuleActionSchema]))
      .min(1)
      .max(5),
    stop_processing: z.boolean(),
  })
  .superRefine((r, c) => {
    r.actions.forEach((a, i) => {
      if (
        !(r.scope === 'mailbox' ? mailboxRuleActionSchema : personalRuleActionSchema).safeParse(a)
          .success
      )
        c.addIssue({
          code: 'custom',
          path: ['actions', i],
          message: 'Esta ação não está disponível neste tipo de regra.',
        });
    });
  });
export type MailRuleInput = z.infer<typeof mailRuleSchema>;
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type MatchMode = MailRuleInput['match_mode'];
export type RuleField = RuleCondition['field'];
export type RuleMessage = {
  from_name: string;
  from_address: string;
  to_addresses: Address[];
  cc_addresses: Address[];
  subject: string;
  body_text: string;
  has_attachments: boolean;
};
export const normalizeRuleText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
export function evaluateConditions(
  rule: Pick<MailRuleInput, 'conditions' | 'match_mode'>,
  msg: RuleMessage,
): boolean {
  const addressList = (items: Address[]) => items.map((a) => `${a.name} <${a.address}>`).join(', ');
  const fields = {
    from: `${msg.from_name} <${msg.from_address}>`,
    to: addressList(msg.to_addresses),
    cc: addressList(msg.cc_addresses),
    any_recipient: addressList([...msg.to_addresses, ...msg.cc_addresses]),
    subject: msg.subject,
    body: msg.body_text.slice(0, 100000),
  };
  const matches = rule.conditions.map((c) => {
    if (c.field === 'has_attachment')
      return c.operator === 'is_true' ? msg.has_attachments : !msg.has_attachments;
    const text = normalizeRuleText(fields[c.field]),
      value = normalizeRuleText(c.value ?? '');
    switch (c.operator) {
      case 'contains':
        return text.includes(value);
      case 'not_contains':
        return !text.includes(value);
      case 'equals':
        return text === value;
      case 'starts_with':
        return text.startsWith(value);
      case 'ends_with':
        return text.endsWith(value);
      default:
        return false;
    }
  });
  return (
    matches.length > 0 &&
    (rule.match_mode === 'all' ? matches.every(Boolean) : matches.some(Boolean))
  );
}
