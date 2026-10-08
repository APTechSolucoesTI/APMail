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
  name: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ' '))
    .pipe(z.string().min(1).max(40)),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Informe uma cor hexadecimal, como #1686A7.')
    .transform((s) => s.toUpperCase()),
  scope: z.enum(['personal', 'tenant']).default('personal'),
  mailbox_mode: z.enum(['all', 'selected']).default('all'),
  mailbox_ids: z.array(z.uuid()).max(100).default([]),
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
  z.object({ type: z.literal('add_label'), label_id: z.uuid() }),
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
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
export const normalizeRuleEmail = (s: string) => s.normalize('NFC').trim().toLowerCase();
export function evaluateConditions(
  rule: Pick<MailRuleInput, 'conditions' | 'match_mode'>,
  msg: RuleMessage,
): boolean {
  const fields = {
    from: [{ name: msg.from_name, address: msg.from_address }],
    to: msg.to_addresses,
    cc: msg.cc_addresses,
    any_recipient: [...msg.to_addresses, ...msg.cc_addresses],
    subject: [msg.subject],
    body: [msg.body_text.slice(0, 100000)],
  };
  const matches = rule.conditions.map((c) => {
    if (c.field === 'has_attachment')
      return c.operator === 'is_true' ? msg.has_attachments : !msg.has_attachments;
    const rawValue = c.value ?? '';
    const emailValue = /^[^\s<>]+@[^\s<>]+$/.test(rawValue.trim());
    const value = emailValue ? normalizeRuleEmail(rawValue) : normalizeRuleText(rawValue);
    const candidates = fields[c.field].flatMap((item) =>
      typeof item === 'string'
        ? [normalizeRuleText(item)]
        : emailValue
          ? [normalizeRuleEmail(item.address)]
          : [
              normalizeRuleText(item.name),
              normalizeRuleText(item.address),
              normalizeRuleText(`${item.name} <${item.address}>`),
            ],
    );
    const match = (text: string) => {
      switch (c.operator) {
        case 'contains':
        case 'not_contains':
          return text.includes(value);
        case 'equals':
          return text === value;
        case 'starts_with':
          return text.startsWith(value);
        case 'ends_with':
          return text.endsWith(value);
        default:
          return false;
      }
    };
    return c.operator === 'not_contains' ? !candidates.some(match) : candidates.some(match);
  });
  return (
    matches.length > 0 &&
    (rule.match_mode === 'all' ? matches.every(Boolean) : matches.some(Boolean))
  );
}
