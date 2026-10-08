import type { MailRuleInput } from '@apmail/shared';
export type PersonalLabel = {
  id: string;
  name: string;
  color: string;
  scope?: 'personal' | 'tenant';
  thread_count?: number;
  mailbox_mode?: 'all' | 'selected';
  mailbox_ids?: string[];
};
export type MailRule = MailRuleInput & {
  id: string;
  created_at: string;
  review_reason?: string | null;
};
export const LABEL_COLOR_NAMES = {
  teal: 'Verde petróleo',
  blue: 'Azul',
  indigo: 'Índigo',
  green: 'Verde',
  amber: 'Âmbar',
  red: 'Vermelho',
  slate: 'Cinza',
  cyan: 'Ciano',
};
