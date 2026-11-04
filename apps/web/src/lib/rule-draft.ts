import type { MailRule } from './organization';

/** Shared defaults for rule settings and creation from an email. */
export function createRuleDraft(mailboxId: string, scope: MailRule['scope']): MailRule {
  return {
    id: '',
    mailbox_id: mailboxId,
    scope,
    name: '',
    is_active: true,
    priority: 100,
    match_mode: 'all',
    conditions: [{ field: 'from', operator: 'contains', value: '' }],
    exceptions: [],
    active_from: null,
    active_until: null,
    actions: [{ type: scope === 'personal' ? 'pin' : 'mark_flagged' }],
    stop_processing: false,
    created_at: '',
  };
}
